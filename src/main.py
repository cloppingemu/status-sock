import asyncio
import os
from socket import gethostname

from starlette.responses import RedirectResponse
import socketio

import updators


REFRESH_PERIOD = 1  # second
STATIC_FILES_DIR = f"{os.path.dirname(__file__)}/static"
ROOT_VIEW = "index.html"

DIST_HTML_TARGETS = {
  "/": f"{STATIC_FILES_DIR}/{ROOT_VIEW}",
  **{
    f"/{fname}": f"{STATIC_FILES_DIR}/{fname}"
    for fname in os.listdir(STATIC_FILES_DIR)
    if fname.split(".")[-1] in ["html", "js", "css", "ico", "png"]
  },
}


def routerMiddleware(app):
  async def routedApp(scope, recieve, send):
    if scope["type"] == "http" and \
      scope["path"] not in ["/socket.io/", *DIST_HTML_TARGETS]:
      print("Redirecting", scope["type"], scope["path"])
      response = RedirectResponse(url="/", status_code=308)
    else:
      response = app
    await response(scope, recieve, send)

  return routedApp


sio = socketio.AsyncServer(async_mode="asgi")
app = routerMiddleware(socketio.ASGIApp(sio, static_files=DIST_HTML_TARGETS))


class Task:
  __slots__ = ("go", "stopped", "num_clients",
               "up_time_checker", "cpu_util_checker",
               "cpu_temp_checker", "mem_checker",
               "disk_io_checker", "disk_usage_checker",
               "net_io_checker", "mount_points_checkers")

  def __init__(self):
    self.go = False
    self.stopped = True
    self.num_clients = 0

    self.up_time_checker = updators.UpTime()
    self.cpu_util_checker = updators.CpuUtil()
    self.cpu_temp_checker = updators.CpuTemp()
    self.mem_checker = updators.MemUtil()
    self.net_io_checker = updators.NetworkIo()
    self.disk_io_checker = updators.DiskIo()
    self.disk_usage_checker = updators.DiskUsage()
    self.mount_points_checkers = updators.MountPoints()

  def refresh(self):
    return (self.cpu_util_checker.refresh(),
            self.cpu_temp_checker.refresh(),
            self.mem_checker.refresh(),
            self.net_io_checker.refresh(),
            self.disk_io_checker.refresh())

  def init(self):
    return (self.disk_usage_checker.refresh(),
            self.mount_points_checkers.refresh(), )

  async def repeat(self):
    self.stopped = False
    cpu_util, cpu_temp, mem_util, net_io, disk_io, _ = await asyncio.gather(
      self.cpu_util_checker.refresh(),
      self.cpu_temp_checker.refresh(),
      self.mem_checker.refresh(),
      self.net_io_checker.refresh(),
      self.disk_io_checker.refresh(),
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

@sio.on("connect")
async def on_connect(sid, _):
  task.num_clients += 1
  print(sid, "connected; Active:", task.num_clients)

  (up_time, cpu_util, cpu_temp,
   mem_util, net_io, disk_io,
   disk_usage, mount_points, *_) = await asyncio.gather(
    task.up_time_checker.refresh(),

    # up_time, cpu_util, cpu_temp,
    # mem_util, net_io, disk_io,
    *task.refresh(),
    # disk_usage, mount_points
    *task.init(),

    sio.emit("client_count", {
      "count": task.num_clients,
    }),
  )

  await sio.emit("status_init", {
    "Up_Time": up_time,
    "CPU_Util": cpu_util,
    "CPU_Temp": cpu_temp,
    "Memory": mem_util,
    "Network_IO": net_io,
    "Total_Network_IO": {
      "tx": task.net_io_checker.last.bytes_sent,
      "rx": task.net_io_checker.last.bytes_recv
    },
    "Disk_IO": disk_io,
    "Disk_Usage": disk_usage,
    "Mount_Points": mount_points,
    "Refresh_Period": REFRESH_PERIOD,
    "Hostname": gethostname(),
  }, to=sid)

  if not task.go:
    task.go = True
    if task.stopped:
      sio.start_background_task(task.repeat)

@sio.on("disconnect")
async def on_disconnect(sid):
  task.num_clients -= 1

  if task.num_clients == 0:
    task.go = False

  print(sid, "disconnected; Active:", task.num_clients)
  await sio.emit("client_count", {"count": task.num_clients})
