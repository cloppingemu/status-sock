# status-sock
Dashboard summarizing machine status. Requires python3, python3-pip and python3-virtualenv installed on system/user level. These can be installed with

`sudo apt-get install python3 python3-pip python3-virtualenv`

Subsequently, required virtual envrionemnt can be created with

`run i`

Development server can be launched with (modification of python source files triggers reloading of the server)

`run d`

Deployment server can be launched with

`run p`

A uvicorn server is used to serve the application, as such, application is only suitable for local networks.

In order to use `status-sock.service` to launch the deployment server upon boot,
1. Create virtual environment and install required packges with `run i`
2. Replace `<insert-user-name>`, `<insert-group-name>` and `<path-to-project-dir>` with user name, group name and path to the project directory respectively.
3. Place `status-sock.service` in /etc/systemd/system/ directory.
4. Run `systemd enable --now sock-status` to enable the unit.

TODO: 

 - `index.js` needs a clean-up. Classes, TS and some modern famework should have been used to manage state.
