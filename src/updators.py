import asyncio
import json
import os
import psutil
import string
import time

from aiohttp.client_exceptions import ClientConnectorError

from meross_iot.model.exception import CommandTimeoutError
from meross_iot.controller.mixins.electricity import ElectricityMixin
from meross_iot.http_api import MerossHttpClient
from meross_iot.manager import MerossManager, TransportMode


class Checkers:
  async def current(self):
    return self._current


class CpuUtil(Checkers):
  __slots__ = ("_current", )

  def __init__(self):
    self._update()

  def _update(self):
      self._current = psutil.cpu_percent(percpu=True)

  async def refresh(self):
    self._update()
    return self._current


class MemUtil(Checkers):
  __slots__ = ("_current", )

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
  __slots__ = ("_current", )

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
  __slots__ = ("_current", "_last")

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
  __slots__ = ("_current", "disks", )

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
  __slots__ = ("_current", )

  def __init__(self):
    self._current = psutil.boot_time()

  async def refresh(self):
    return int(time.time() - self._current)



with open(os.path.join(os.path.dirname(__file__), "creds.json")) as f:
  creds = json.load(f)
  MEROSS_USERNAME = creds["MEROSS_USERNAME"]
  MEROSS_PASSWORD = creds["MEROSS_PASSWORD"]

class Meross(Checkers):
  __slots__ = ("manager", "http_api_client", "devs", "_current", )

  def __init__(self):
    self._current = {}

  async def setup(self):
    while True:
      try:
        self.http_api_client = await MerossHttpClient.async_from_user_password(
          api_base_url="https://iotx-ap.meross.com",
          email=MEROSS_USERNAME,
          password=MEROSS_PASSWORD
        )
        break
      except ClientConnectorError:
        pass

    self.manager = MerossManager(http_client=self.http_api_client)
    await self.manager.async_init()
    await self.manager.async_device_discovery()

    self.devs = self.manager.find_devices(device_class=ElectricityMixin)
    if len(self.devs) < 1:
      await self.exit()
      raise ValueError("No electricity-capable device found")
    self.manager.default_transport_mode = TransportMode.LAN_HTTP_FIRST_ONLY_GET

    await asyncio.gather(*[dev.async_update() for dev in self.devs])
    await self._update()

  async def _update(self):
    instances = await asyncio.gather(*[dev.async_get_instant_metrics() for dev in self.devs], return_exceptions=True)
    for dev, inst in zip(self.devs, instances):
      if isinstance(inst, CommandTimeoutError):
        print(f"Connection error in retrieving {dev.name}")
        self._current[dev.name] = self._current[dev.name]
      else:
        self._current[dev.name] = inst.power

  async def refresh(self):
    await self._update()
    return self._current

  async def cleanup(self):
    print("Meross cleanup crew")
    self.manager.close()
    await self.http_api_client.async_logout()


class Task:
  __slots__ = ("go", "stopped", "sio",
               "up_time_checker", "cpu_util_checker",
               "cpu_temp_checker", "mem_util_checker",
               "disk_io_checker", "net_io_checker",
               "meross_checker")

  def __init__(self):
    self.go = False
    self.stopped = True

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

  async def up_time(self):
    return await self.up_time_checker.refresh()

  async def current(self):
    return await asyncio.gather(
      self.cpu_util_checker.current(),
      self.cpu_temp_checker.current(),
      self.mem_util_checker.current(),
      self.net_io_checker.current(),
      self.disk_io_checker.current(),
      self.meross_checker.current(),
    )

  @staticmethod
  def _refresh(*args):
    return [resource.refresh() for resource in args]

  async def repeat(self, period):
    self.stopped = False

    cpu_util, cpu_temp, mem_util, disk_io, net_io, meross, _ = await asyncio.gather(
      *self._refresh(
        self.cpu_util_checker,
        self.cpu_temp_checker,
        self.mem_util_checker,
        self.disk_io_checker,
        self.net_io_checker,
        self.meross_checker,
      ),
      self.sio.sleep(period),
    )

    while self.go:
      cpu_util, cpu_temp, mem_util, disk_io, net_io, meross, *_ = await asyncio.gather(
        *self._refresh(
          self.cpu_util_checker,
          self.cpu_temp_checker,
          self.mem_util_checker,
          self.disk_io_checker,
          self.net_io_checker,
          self.meross_checker,
        ),

        self.sio.sleep(period),

        self.sio.emit("status_update", {
          "CPU_Util": cpu_util,
          "CPU_Temp": cpu_temp,
          "Memory": mem_util,
          "Disk_IO": disk_io,
          "Network_IO": net_io,
          "Meross_Power": meross,
        }),
      )

    self.stopped = True
    print("Exiting background task")



class SioStub:
  __slots__ = ["on_shutdown", "task"]

  def __init__(self, *_, on_shutdown):
    self.on_shutdown = on_shutdown

  @staticmethod
  async def sleep(period):
    return await asyncio.sleep(period)

  @staticmethod
  async def emit(*args, **kwargs):
    print(*args, **kwargs, sep=": ")

  def start_background_task(self, task, *args, **kwargs):
    self.task = asyncio.create_task(task(*args, **kwargs))

  async def stop(self):
    await self.task
    await self.on_shutdown()

  async def __aenter__(self):
    return self

  async def __aexit__(self, *_):
    return await self.stop()


async def main():
  checker = Task()

  async with SioStub(on_shutdown=checker.cleanup) as sio:
    await checker.setup(sio)

    checker.go = True
    sio.start_background_task(checker.repeat, 1)

    await asyncio.sleep(20)

    checker.go = False


if __name__ == "__main__":
  asyncio.run(main())
