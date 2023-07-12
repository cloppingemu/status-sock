import time
import psutil
import asyncio

import string


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


if __name__ == "__main__":
  asyncio.run(main())
