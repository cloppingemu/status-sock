import asyncio
import os
from socket import gethostname
import json
import logging

import socketio

from logger import ssLogger
import updators

logging.basicConfig(level=logging.WARNING)

DIRNAME = os.path.dirname(os.path.abspath(__file__))
STATIC_FILES_DIR = os.path.join(DIRNAME, "static")
ROOT_VIEW = "index.html"

REFRESH_PERIOD = 1        # second(s)
REDISCOVER_PERIOD = 60    # seconds

with open(os.path.join(DIRNAME, "creds.json")) as c:
  SERVER_MEROSS_NAME = json.load(c)["SERVER_NAME"]


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

  num_clients = num_clients + 1

  if not task_setup.done():
    await task_setup

  ssLogger.info(f"{sid} connected; Active: {num_clients}\n")

  if not task.go:
    await asyncio.gather(
      *task.refresh_task(),
      sio.sleep(REFRESH_PERIOD),
    )

  up_time, cpu_util, cpu_temp, mem_util, net_io, disk_io, meross_power = (
    task.up_time(),
    *task.current(),
  )

  await asyncio.gather(
    sio.emit("status_init", {
      "Up_Time": up_time,
      "Hostname": gethostname(),
      "Refresh_Period": REFRESH_PERIOD,
      "CPU_Util": cpu_util,
      "CPU_Temp": cpu_temp,
      "Memory": mem_util,
      "Network_IO": net_io,
      "Disk_IO": disk_io,
      "Meross_Power": meross_power,
      "Time": REFRESH_PERIOD,
      "Server_Meross_Name": SERVER_MEROSS_NAME
    }, to=sid),
  )

  if not task.go:
    task.go = True
    if task.rediscovery_stopped:
      sio.start_background_task(task.rediscover, REDISCOVER_PERIOD)

    if task.repeat_stopped:
      sio.start_background_task(task.repeat, REFRESH_PERIOD)

@sio.on("disconnect")
async def on_disconnect(sid):
  global num_clients, task

  num_clients = num_clients - 1

  if num_clients == 0:
    task.go = False

  ssLogger.info(f"{sid} disconnected; Active: {num_clients}\n")
