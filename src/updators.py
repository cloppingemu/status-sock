import time
import psutil
import asyncio

from string import digits


class CpuUtil:
  async def refresh(self):
    return psutil.cpu_percent(percpu=True)


class MemUtil:
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
  async def refresh(self):
    return {
      k: [s.current for s in v]
      for k, v in psutil.sensors_temperatures().items()
    }


class NetworkIo:
  def __init__(self):
    self._last = psutil.net_io_counters()

  async def refresh(self):
    """
    -> TX, RX (Bps)
    """
    net_io = psutil.net_io_counters()
    net_tx = net_io.bytes_sent - self._last.bytes_sent
    net_rx = net_io.bytes_recv - self._last.bytes_recv
    self._last = net_io
    return {"tx": net_tx, "rx": net_rx}


class DiskIo:
  def __init__(self):
    self.register()

  def register(self):
    self._last = psutil.disk_io_counters(perdisk=True)
    self._disks = self.filter_drives(self._last)

  @staticmethod
  def filter_drives(disks):
    return {
      disk for disk in disks if disk.isalpha()
        or disk.rstrip(digits).endswith("mmcblk")
        or disk.rstrip(digits).endswith("nvme0n")
    }

  async def refresh(self):
    """
    -> disk: {read: , write: } (Bps)
    """
    io = psutil.disk_io_counters(perdisk=True)
    new_disks = self.filter_drives(io)

    lost_disks = self._disks - new_disks
    if lost_disks:
      self._disks = new_disks

    disk_io = {
      disk: {
        "read": io[disk].read_bytes - self._last[disk].read_bytes,
        "write": io[disk].write_bytes - self._last[disk].write_bytes,
      } for disk in self._disks
    }

    self._last = io

    unseen_disks = new_disks - self._disks
    if unseen_disks:
      self._disks = new_disks
      return {
        **disk_io,
        **{k: {"read": 0, "write": 0} for k in unseen_disks}
      }

    return disk_io


class UpTime:
  def __init__(self):
    self._boot_time = psutil.boot_time()

  async def refresh(self):
    return int(time.time() - self._boot_time)


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
