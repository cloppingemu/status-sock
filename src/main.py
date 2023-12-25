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

task = updators.Task()

sio = socketio.AsyncServer(async_mode="asgi")
app = socketio.ASGIApp(sio, static_files=dist_html_targets, on_shutdown=task.cleanup)

num_clients = 0

task_setup = asyncio.create_task(task.setup(sio))

@sio.on("connect")
async def on_connect(sid, *_):
  global num_clients, task, task_setup

  if not task_setup.done():
    await task_setup

  num_clients += 1
  print(sid, "connected; Active:", num_clients)

  up_time, (cpu_util, cpu_temp, mem_util, net_io, disk_io, meross_power), *_ = await asyncio.gather(
    task.up_time(),
    task.current(),
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
    "Meross_Power": meross_power,
    "Refresh_Period": REFRESH_PERIOD,
    "Hostname": gethostname(),
  }, to=sid)

  if not task.go:
    task.go = True
    if task.stopped:
      sio.start_background_task(task.repeat, REFRESH_PERIOD)


@sio.on("disconnect")
async def on_disconnect(sid):
  global num_clients, task

  num_clients = num_clients - 1

  if num_clients == 0:
    task.go = False

  print(sid, "disconnected; Active:", num_clients)
  await sio.emit("client_count", {"count": num_clients})
