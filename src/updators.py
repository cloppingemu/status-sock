import asyncio
import psutil
import string
import time
import weakref

from meross_iot.controller.mixins.electricity import ElectricityMixin
from meross_iot.http_api import MerossHttpClient
from meross_iot.manager import MerossManager

class CpuUtil:
  __slots__ = tuple()

  async def refresh(self):
    return psutil.cpu_percent(percpu=True)


class MemUtil():
  __slots__ = tuple()

  async def total(self):
    ram = psutil.virtual_memory().total
    swap = psutil.swap_memory().total

    return {"RAM": ram, "Swap": swap}

  async def refresh(self):
    ram = psutil.virtual_memory()
    swap = psutil.swap_memory()

    ram_util = (ram.total - ram.available)
    swap_util = swap.used

    return {"RAM": ram_util, "Swap": swap_util}


class CpuTemp:
  __slots__ = tuple()

  async def refresh(self):
    return {
      k: [s.current for s in v]
      for k, v in psutil.sensors_temperatures().items()
    }


class NetworkIo:
  __slots__ = ("last", )

  def __init__(self):
    self.last = psutil.net_io_counters()

  async def refresh(self):
    """
    -> TX, RX (Bps)
    """
    net_io = psutil.net_io_counters()
    net_tx = net_io.bytes_sent - self.last.bytes_sent
    net_rx = net_io.bytes_recv - self.last.bytes_recv
    self.last = net_io
    return {"tx": net_tx, "rx": net_rx}


class DiskIo:
  __slots__ = ("last", "disks", )

  def __init__(self):
    self.register()

  def register(self):
    self.last = psutil.disk_io_counters(perdisk=True)
    self.disks = self.filter_drives(self.last)

  @staticmethod
  def filter_drives(disks):
    return {
      disk for disk in disks if disk.isalpha()
        or disk.rstrip(string.digits).endswith("mmcblk")
        or disk.rstrip(string.digits).endswith("nvme0n")
    }

  async def refresh(self):
    """
    -> disk: {read: , write: } (Bps)
    """
    io = psutil.disk_io_counters(perdisk=True)
    new_disks = self.filter_drives(io)

    lost_disks = self.disks - new_disks
    if lost_disks:
      self.disks = new_disks

    disk_io = {
      disk: {
        "read": io[disk].read_bytes - self.last[disk].read_bytes,
        "write": io[disk].write_bytes - self.last[disk].write_bytes,
      } for disk in self.disks
    }

    self.last = io

    unseen_disks = new_disks - self.disks
    if unseen_disks:
      self.disks = new_disks
      disk_io = {
        **disk_io,
        **{k: {"read": 0, "write": 0} for k in unseen_disks}
      }

    return disk_io


class UpTime:
  __slots__ = ("boot_time", )

  def __init__(self):
    self.boot_time = psutil.boot_time()

  async def refresh(self):
    return int(time.time() - self.boot_time)


class Meross:
  def __init__(self):
    pass

  @classmethod
  async def init(cls):
    self = cls()
    self.http_api_client = await MerossHttpClient.async_from_user_password(api_base_url="https://iotx-ap.meross.com", email="writetosoni@outlook.com", password="ciV2MR!UM$*6Vj%D8a")
    self.manager = MerossManager(http_client=self.http_api_client)
    await self.manager.async_init()

    self.devs = self.manager.find_devices(device_class=ElectricityMixin)

    if len(self.devs) < 1:
      await self.exit()
      raise ValueError("No electricity-capable device found")

    asyncio.gather(*[dev.async_update() for dev in self.devs()])

  async def refresh(self):
    instant_consumption = await asyncio.gather(*[dev.async_get_instant_metrics() for dev in self.devs])
    print(f"Current consumption data: {instant_consumption}")

  async def exit(self):
    self.manager.close()
    await self.http_api_client.async_logout()

async def main():
  mem_util = MemUtil()
  cpu_util = CpuUtil()
  cpu_temp = CpuTemp()
  net_io = NetworkIo()
  disk_io = DiskIo()
  up_time = UpTime()

  print("UpTime (s)",
        "CPU-util test (%util)",
        "CPU-temp test (°C)",
        "Mem-util test (B)",
        "Net IO test (Bps)",
        "Disk IO test (Bps)", sep="\t")

  for _ in range(50):
    *v, _ = await asyncio.gather(
      up_time.refresh(),
      cpu_util.refresh(),
      cpu_temp.refresh(),
      mem_util.refresh(),
      net_io.refresh(),
      disk_io.refresh(),

      asyncio.sleep(0.25),
    )
    print("\t".join(map(str, v)))



async def meross():
  meross = await Meross.init()

  for _ in range(5):
    *v, _ = await asyncio.gather(
      meross.refresh(),
      asyncio.sleep(5)
    )
    print(v)

  await meross.exit()


if __name__ == "__main__":
  asyncio.run(meross())
