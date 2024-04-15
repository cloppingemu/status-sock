import asyncio
import json
import os
import psutil
import string
import time

from meross_iot.controller.mixins.electricity import ElectricityMixin
from meross_iot.http_api import MerossHttpClient
from meross_iot.manager import MerossManager, TransportMode


class Checkers:
  __slots__ = ("_current", )

  def current(self):
    return self._current


class CpuUtil(Checkers):

  def __init__(self):
    self._update()

  def _update(self):
      self._current = psutil.cpu_percent(percpu=True)

  async def refresh(self):
    self._update()
    return self._current


class MemUtil(Checkers):

  def __init__(self):
    self._update()

  async def total(self):
    ram = psutil.virtual_memory().total
    swap = psutil.swap_memory().total

    return {"RAM": ram, "Swap": swap}

  def _update(self):
      ram = psutil.virtual_memory()
      swap = psutil.swap_memory()

      ram_util = (ram.total - ram.available)
      swap_util = swap.used

      self._current = {"RAM": ram_util, "Swap": swap_util}

  async def refresh(self):
    self._update()
    return self._current


class CpuTemp(Checkers):

  def __init__(self):
    self._update()

  def _update(self):
    self._current = {
      k: [s.current for s in v]
      for k, v in psutil.sensors_temperatures().items()
    }

  async def refresh(self):
    self._update()
    return self._current


class NetworkIo(Checkers):
  __slots__ = ("_last", )

  def __init__(self):
    self._last = psutil.net_io_counters()
    self._current = self._last

  def _update(self):
      net_io = psutil.net_io_counters()
      net_tx = net_io.bytes_sent - self._last.bytes_sent
      net_rx = net_io.bytes_recv - self._last.bytes_recv
      self._last = net_io
      self._current = {"tx": net_tx, "rx": net_rx}

  async def refresh(self):
    self._update()
    return self._current


class DiskIo(Checkers):
  __slots__ = ("disks", )

  def __init__(self):
    self.register()

  def register(self):
    self._current = psutil.disk_io_counters(perdisk=True)
    self.disks = self.filter_drives(self._current)

  @staticmethod
  def filter_drives(disks):
    return {
      disk for disk in disks if disk.isalpha()
        or disk.rstrip(string.digits).endswith("mmcblk")
        or disk.rstrip(string.digits).endswith("nvme0n")
    }

  async def refresh(self):
    io = psutil.disk_io_counters(perdisk=True)
    new_disks = self.filter_drives(io)

    lost_disks = self.disks - new_disks
    if lost_disks:
      self.disks = new_disks

    disk_io = {
      disk: {
        "read": io[disk].read_bytes - self._current[disk].read_bytes,
        "write": io[disk].write_bytes - self._current[disk].write_bytes,
      } for disk in self.disks
    }

    self._current = io

    unseen_disks = new_disks - self.disks
    if unseen_disks:
      self.disks = new_disks
      disk_io = {
        **disk_io,
        **{k: {"read": 0, "write": 0} for k in unseen_disks}
      }

    return disk_io


class UpTime(Checkers):
  def __init__(self):
    self._current = psutil.boot_time()

  def refresh(self):
    return int(time.time() - self._current)


creds_json = os.path.join(os.path.dirname(__file__), "creds.json")
with open(creds_json) as fp:
  creds = json.load(fp)
  MEROSS_USERNAME = creds["MEROSS_USERNAME"]
  MEROSS_PASSWORD = creds["MEROSS_PASSWORD"]

class Meross(Checkers):
  __slots__ = ("manager", "http_api_client", "devs", "lock", "unsuccessful_retrieval", )

  def __init__(self):
    self._current = {}
    self.lock = asyncio.Lock()
    self.unsuccessful_retrieval = True

  async def setup(self):
    self.http_api_client = await MerossHttpClient.async_from_user_password(
      api_base_url="https://iotx-ap.meross.com",
      email=MEROSS_USERNAME,
      password=MEROSS_PASSWORD
    )

    self.manager = MerossManager(http_client=self.http_api_client)
    await self.manager.async_init()

    self.manager.default_transport_mode = TransportMode.LAN_HTTP_FIRST_ONLY_GET
    await self.rediscover_devices()

    await self._update()

    self.manager.register_push_notification_handler_coroutine(self.rediscover_devices)

  async def rediscover_devices(self, *_):
      if self.unsuccessful_retrieval:
        async with self.lock:
          await self.manager.async_device_discovery()
          devs = self.manager.find_devices(device_class=ElectricityMixin)

          updates = await asyncio.gather(*[dev.async_update() for dev in devs], return_exceptions=True)
          self.devs = [dev for dev, update in zip(devs, updates) if not isinstance(update, Exception)]

          if len(devs) == len(self.devs):
            self.unsuccessful_retrieval = False

  async def _update(self):
    async with self.lock:
      instances = await asyncio.gather(*[dev.async_get_instant_metrics() for dev in self.devs], return_exceptions=True)

    for dev, inst in zip(self.devs, instances):
      try:
        self._current[dev.name] = inst.power
      except AttributeError:
        print(f"Connection error in retrieving {dev.name}")
        self._current.pop(dev.name)
        self.unsuccessful_retrieval = True
        await self.rediscover_devices()

  async def refresh(self):
    await self._update()
    return self._current

  async def cleanup(self):
    print("Meross cleanup")
    self.manager.close()
    await self.http_api_client.async_logout()


class Task:
  __slots__ = ("go", "sio",
               "repeat_stopped", "rediscovery_stopped",
               "meross_checker",
               "up_time_checker", "cpu_util_checker",
               "cpu_temp_checker", "mem_util_checker",
               "disk_io_checker", "net_io_checker")

  def __init__(self):
    self.go = False
    self.repeat_stopped = True
    self.rediscovery_stopped = True

    self.up_time_checker = UpTime()

    self.cpu_util_checker = CpuUtil()
    self.cpu_temp_checker = CpuTemp()
    self.mem_util_checker = MemUtil()
    self.disk_io_checker = DiskIo()
    self.net_io_checker = NetworkIo()
    self.meross_checker = Meross()

  async def setup(self, sio):
    await self.meross_checker.setup()
    self.sio = sio

  async def cleanup(self):
    await self.meross_checker.cleanup()

  def up_time(self):
    return self.up_time_checker.refresh()

  def current(self):
    return (
      self.cpu_util_checker.current(),
      self.cpu_temp_checker.current(),
      self.mem_util_checker.current(),
      self.net_io_checker.current(),
      self.disk_io_checker.current(),
      self.meross_checker.current(),
    )

  def refresh_task(self):
    return [
      self.cpu_util_checker.refresh(),
      self.cpu_temp_checker.refresh(),
      self.mem_util_checker.refresh(),
      self.disk_io_checker.refresh(),
      self.net_io_checker.refresh(),
      self.meross_checker.refresh(),
    ]

  async def repeat(self, period):
    self.repeat_stopped = False

    t_now = time.time()

    cpu_util, cpu_temp, mem_util, disk_io, net_io, meross, _ = await asyncio.gather(
      *self.refresh_task(),
      self.sio.sleep(period),
    )

    while self.go:
      t_now, t_last = time.time(), t_now

      cpu_util, cpu_temp, mem_util, disk_io, net_io, meross, *_ = await asyncio.gather(
        *self.refresh_task(),
        self.sio.sleep(period),

        self.sio.emit("status_update", {
          "CPU_Util": cpu_util,
          "CPU_Temp": cpu_temp,
          "Memory": mem_util,
          "Network_IO": net_io,
          "Disk_IO": disk_io,
          "Meross_Power": meross,
          "Time": t_now - t_last,
        }),
      )

    self.repeat_stopped = True

  async def rediscover(self, period):
    self.rediscovery_stopped = False
    await self.sio.sleep(period)

    while self.go:
      await asyncio.gather(
        self.meross_checker.rediscover_devices(),
        self.sio.sleep(period)
      )

    self.rediscovery_stopped = True


class SioStub:
  __slots__ = ["on_shutdown", "tasks"]

  def __init__(self, *_, on_shutdown=None):
    self.tasks = []
    self.on_shutdown = on_shutdown

  @staticmethod
  async def sleep(period):
    return await asyncio.sleep(period)

  @staticmethod
  async def emit(*args, **kwargs):
    print(*args, **kwargs, sep=": ")

  def start_background_task(self, task, *args, **kwargs):
    self.tasks.append(asyncio.create_task(task(*args, **kwargs)))

  async def stop(self):
    await asyncio.gather(*self.tasks, return_exceptions=True)
    if self.on_shutdown is not None:
      if isinstance(self.on_shutdown, (list, tuple)):
        await asyncio.gather(*[t() for t in self.on_shutdown])
      else:
        await self.on_shutdown()

  async def __aenter__(self):
    return self

  async def __aexit__(self, *_):
    return await self.stop()


async def main():
  checker = Task()

  async with SioStub(on_shutdown=[checker.cleanup, ]) as sio:
    await checker.setup(sio)


    checker.go = True

    REFRESH_PERIOD = 2
    sio.start_background_task(checker.repeat, REFRESH_PERIOD)

    REDISCOVER_PERIOD = 5
    sio.start_background_task(checker.rediscover, REDISCOVER_PERIOD)

    await sio.sleep(60)

    checker.go = False


if __name__ == "__main__":
  asyncio.run(main())
