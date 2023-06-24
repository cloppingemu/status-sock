# Status-Sock
Light-weight dashboard summarizing machine status. Requires python3, python3-pip and python3-virtualenv installed on system/user level. These can be installed with

`apt install python3 python3-pip python3-virtualenv`

Subsequently, required virtual envrionemnt can be created with

`bash run env`

Development server can be launched with (modification of python source files triggers reloading of the server)

`bash run dev`

Deployment server can be launched with

`bash run prod`

A uvicorn server is used to serve the application, as such, application is only suitable for local networks.

In order to launch the deployment server upon boot, use `status-sock.service` as following
1. Ensure python3, pip and virtualenv are installed with `apt install python3 python3-pip python3-virtualenv`
2. Create virtual environment and install required packges with `bash run e`.
3. Replace `<insert-user-name>`, `<insert-group-name>` and `<path-to-project-dir>` with user name, group name (generally same as user name) and path to the project directory respectively in the file `status-sock.service`.
4. Place `status-sock.service` in the directory `/etc/systemd/system/`.
5. Run `systemd enable --now sock-status.service` to enable and launch the service. Dashboard server will be available at port 32000.


TODO:
 - `index.js` needs a clean-up. Classes, TS and some modern famework should have been used to manage state.
