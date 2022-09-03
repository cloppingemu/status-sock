import os
import time
import updators

import asyncio
import socketio

from socket import gethostname

REFRESH_PERIOD = 1  # second

STATIC_FILES_DIR = f"{os.path.dirname(__file__)}/static"

ROOT_VIEW = "index.html"
dist_html_targets = {
  "/": f"{STATIC_FILES_DIR}/{ROOT_VIEW}",
}
dist_html_targets = {
  **dist_html_targets,
  **{
    f"/{fname}": f"{STATIC_FILES_DIR}/{fname}"
    for fname in os.listdir(STATIC_FILES_DIR)
    if fname.split(".")[-1] in ["html", "js", "css", "ico", "png"]
  },
}


sio = socketio.AsyncServer(async_mode="asgi")
app = socketio.ASGIApp(sio, static_files=dist_html_targets)


up_time_checker = updators.UpTime()
cpu_util_checker = updators.CpuUtil()
cpu_temp_checker = updators.CpuTemp()
mem_checker = updators.MemUtil()
disk_io_checker = updators.DiskIo()
net_io_checker = updators.NetworkIo()

async def task():
  task.stopped = False
  cpu_util, cpu_temp, mem_util, net_io, disk_io, _ = await asyncio.gather(
    cpu_util_checker.refresh(),
    cpu_temp_checker.refresh(),
    mem_checker.refresh(),
    net_io_checker.refresh(),
    disk_io_checker.refresh(),

    sio.sleep(REFRESH_PERIOD),
  )
  while task.go:
    cpu_util, cpu_temp, mem_util, net_io, disk_io, *_ = await asyncio.gather(
      cpu_util_checker.refresh(),
      cpu_temp_checker.refresh(),
      mem_checker.refresh(),
      net_io_checker.refresh(),
      disk_io_checker.refresh(),

      sio.sleep(REFRESH_PERIOD),

      sio.emit("status_update", {
        "CPU_Util": cpu_util,
        "CPU_Temp": cpu_temp,
        "Memory": mem_util,
        "Network_IO": net_io,
        "Disk_IO": disk_io,
      }),
    )
  task.stopped = True
  print("Exiting background task")
task.go = False
task.stopped = True


num_clients = 0


@sio.on("connect")
async def on_connect(sid, _):
  global num_clients, task

  num_clients = num_clients + 1
  print(sid, "connected; Active:", num_clients)

  up_time, cpu_util, cpu_temp, mem_util, net_io, disk_io, *_ = await asyncio.gather(
    up_time_checker.refresh(),
    cpu_util_checker.refresh(),
    cpu_temp_checker.refresh(),
    mem_checker.total(),
    net_io_checker.refresh(),
    disk_io_checker.refresh(),

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
      sio.start_background_task(task)


@sio.on("disconnect")
async def on_disconnect(sid):
  global num_clients, task
  num_clients = num_clients - 1

  if num_clients == 0:
    task.go = False

  print(sid, "disconnected; Active:", num_clients)
  await sio.emit("client_count", {"count": num_clients})
