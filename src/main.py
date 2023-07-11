import asyncio
import os
from socket import gethostname

import socketio

import updators

REFRESH_PERIOD = 1  # second
STATIC_FILES_DIR = f"{os.path.dirname(__file__)}/static"
ROOT_VIEW = "index.html"

dist_html_targets = {
  "/": f"{STATIC_FILES_DIR}/{ROOT_VIEW}",
  "/*": f"{STATIC_FILES_DIR}/{ROOT_VIEW}",
  **{
    f"/{fname}": f"{STATIC_FILES_DIR}/{fname}"
    for fname in os.listdir(STATIC_FILES_DIR)
    if fname.split(".")[-1] in ["html", "js", "css", "ico", "png"]
  },
}

sio = socketio.AsyncServer(async_mode="asgi")
app = socketio.ASGIApp(sio, static_files=dist_html_targets)


class Task:
  __slots__ = ("go", "stopped",
               "up_time_checker", "cpu_util_checker",
               "cpu_temp_checker", "mem_checker",
               "disk_io_checker", "net_io_checker")

  def __init__(self):
    self.go = False
    self.stopped = True

    self.up_time_checker = updators.UpTime()
    self.cpu_util_checker = updators.CpuUtil()
    self.cpu_temp_checker = updators.CpuTemp()
    self.mem_checker = updators.MemUtil()
    self.disk_io_checker = updators.DiskIo()
    self.net_io_checker = updators.NetworkIo()

  def refresh(self):
    return (self.cpu_util_checker.refresh(),
            self.cpu_temp_checker.refresh(),
            self.mem_checker.refresh(),
            self.disk_io_checker.refresh(),
            self.net_io_checker.refresh())

  async def repeat(self):
    self.stopped = False
    cpu_util, cpu_temp, mem_util, net_io, disk_io, _ = await asyncio.gather(
      *self.refresh(),
      sio.sleep(REFRESH_PERIOD),
    )

    while self.go:
      cpu_util, cpu_temp, mem_util, net_io, disk_io, *_ = await asyncio.gather(
        *self.refresh(),

        sio.sleep(REFRESH_PERIOD),

        sio.emit("status_update", {
          "CPU_Util": cpu_util,
          "CPU_Temp": cpu_temp,
          "Memory": mem_util,
          "Network_IO": net_io,
          "Disk_IO": disk_io,
        }),
      )
    self.stopped = True
    print("Exiting background task")


task = Task()
num_clients = 0

@sio.on("connect")
async def on_connect(sid, _):
  global num_clients, task

  num_clients += 1
  print(sid, "connected; Active:", num_clients)

  up_time, cpu_util, cpu_temp, mem_util, net_io, disk_io, *_ = await asyncio.gather(
    task.up_time_checker.refresh(),

    *task.refresh(),

    sio.emit("client_count", {
      "count": num_clients,
    }),
  )

  await sio.emit("status_init", {
    "Up_Time": up_time,
    "CPU_Util": cpu_util,
    "CPU_Temp": cpu_temp,
    "Memory": mem_util,
    "Network_IO": net_io,
    "Disk_IO": disk_io,
    "Refresh_Period": REFRESH_PERIOD,
    "Hostname": gethostname(),
  }, to=sid)

  if not task.go:
    task.go = True
    if task.stopped:
      sio.start_background_task(task.repeat)

@sio.on("disconnect")
async def on_disconnect(sid):
  global num_clients, task

  num_clients = num_clients - 1

  if num_clients == 0:
    task.go = False

  print(sid, "disconnected; Active:", num_clients)
  await sio.emit("client_count", {"count": num_clients})
