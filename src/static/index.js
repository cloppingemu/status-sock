let NUM_CPU_PACKAGES = 2;
let NUM_CPU_CORES = 1;
let MAX_RAM_SIZE = 1;

const LINE_SHAPE = 'spline';  // 'linear';
const LINE_SMOOTHING = 1.0;   // Has an effect only if `shape` is set to "spline". Sets the amount of smoothing.
                              // "0" corresponds to no smoothing (equivalent to a "linear" shape).

const HISTORY_TIME = 31;  // seconds
const CONVERSION_FROM_B = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024
}

let trace = "CPU_util";
let NUM_TESTER = /[0-9]/;
let isDarkMode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

let disk_to_show = "";

let init_done = 0;  // not done
let REFRESH_PERIOD = 1.;  // s
let HISTORY_SIZE = HISTORY_TIME / REFRESH_PERIOD;
let HISTORY_LAST = HISTORY_SIZE - 1;

// const PLOTLY_COLORS = [
//   '#1f77b4',  // muted blue
//   '#ff7f0e',  // safety orange
//   '#2ca02c',  // cooked asparagus green
//   '#d62728',  // brick red
//   '#9467bd',  // muted purple
//   '#8c564b',  // chestnut brown
//   '#e377c2',  // raspberry yogurt pink
//   '#7f7f7f',  // middle gray
//   '#bcbd22',  // curry yellow-green
//   '#17becf'   // blue-teal
// ]


function clip10(c, n) {
  if (c > 10 || n == 0) {
    return Math.round(c);
  } else {
    return (Math.round(c * 10**n) * 10**-n).toFixed(n);
  }
}

// ----------------------------------------------------


let network_io_unit = "KB";
let disk_io_unit = "MB";
let memory_unit = "GB"

const layout_config = {
  Memory: {
    chart_title: "Memory",
    y_title: "Util (GB)",
    y_axis_max: MAX_RAM_SIZE,
    legend_traceorder: "normal",
    updator: update_Memory,
  },
  CPU_util: {
    chart_title: "CPU Util",
    y_title: "Util (%)",
    y_axis_max: 100,
    legend_traceorder: "reversed",
    updator: update_CPU_util,
  },
  CPU_temp: {
    chart_title: "CPU Temp",
    y_title: "Temp (°C)",
    y_axis_max: 100,
    legend_traceorder: "normal",
    updator: update_CPU_temp,
  },
  Disk_io: {
    chart_title: "Disk IO",
    y_title: `Disk IO (${disk_io_unit}ps)`,
    y_axis_max: 10,
    legend_traceorder: "normal",
    updator: update_Disk_io,
  },
  Network_io: {
    chart_title: "Network IO",
    y_title: `Net IO (${network_io_unit}ps)`,
    y_axis_max: 1024,
    legend_traceorder: "normal",
    updator: update_Neteork_io,
  },
};


// ----------------------------------------------------


let time = [...Array(HISTORY_SIZE).keys()].reverse();
let Up_Time = 0;

let mem_util = { };
let MemTraces = [ ];

let CpuUtilTraces = [ ];

let sensor_to_show;
let temp_sensors = { };
let CpuTempTraces = [ ];

const all_disks = [ ];
const disk_io = { };
let DiskIoTraces = [ ];

let network_io = { };
let NetworkIoTraces = [ ];

let Traces = {
  CPU_util: CpuUtilTraces,
  Memory: MemTraces,
  CPU_temp: CpuTempTraces,
  Network_io: NetworkIoTraces,
  Disk_io: DiskIoTraces,
};

const layout = {
  title: {
    text: "CPU Temp",
    font: {
      size: 25
    },
  },
  plot_bgcolor: '#fff',
  paper_bgcolor: "#fff",

  yaxis: {
    autorange: false,
    title: "Util (%)",
    range: [0, 100],
    gridcolor: "#ddd",
    ticksuffix : "  ",
  },
  xaxis: {
    autorange: "reversed",
    gridcolor: "#ddd",
    range: [HISTORY_TIME - 1, 0],
    autorange: false,
  },

  margin: {
    r: 15,
    l: 50,
    t: 75,
    b: 0,
  },

  font: {
    color: "#000"
  },

  showlegend: true,
  legend: {
    orientation: "h"
  }
};
const color_scheme_layout = {
  dark: {
    plot_bgcolor: "#111",
    paper_bgcolor: "#000",
    gridcolor: "#888",
    font_color: "#fff",
  },
  light: {
    plot_bgcolor: "#fff",
    paper_bgcolor: "#fff",
    gridcolor: "#ddd",
    font_color: "#000",
  }
}

const eventNameMapping = {
  "CPU_util": "cpu-util",
  "CPU_temp": "cpu-temp",
  "Memory": "memory",
  "Network_io": "network",
  "Disk_io": "disk-io",
}

function ChangePlot(event, key) {
  if ((event != 0 && ["select", "option"].includes(event.target.nodeName.toLowerCase()))) {
    return;
  }
  view = views.indexOf(key)+1;
  trace = key;
  layout.title.text = layout_config[key].chart_title;
  layout.yaxis.title = layout_config[key].y_title;
  layout.yaxis.range[1] = layout_config[key].y_axis_max;
  layout.legend.traceorder = layout_config[key].legend_traceorder;

  for (const element of document.getElementsByClassName("navigator-targets")) {
    if (element.classList.contains(eventNameMapping[key])) {
      element.style.border = "1px solid var(--active-border)";
      // element.style.boxShadow = "0px 0px 2px var(--active-border)";
      element.style.backgroundColor = "var(--active-cell)";
    } else {
      element.style.border = "1px solid var(--inactive-border)";
      // element.style.boxShadow = "0px 0px 0px var(--inactive-border)";
      element.style.backgroundColor = "var(--inactive-cell)";
    }
  }

  Plotly.newPlot("Plot-Area", Traces[key], layout, {
    staticPlot: true
  });
}

function UpdatePlotColors(scheme) {
  // CpuTempTraces[0].line.color = isDarkMode ? "#fff" : "#000";
  CpuUtilTraces[NUM_CPU_CORES].line.color = isDarkMode ? "#fff" : "#000";

  layout.plot_bgcolor = color_scheme_layout[scheme].plot_bgcolor;
  layout.paper_bgcolor = color_scheme_layout[scheme].paper_bgcolor;
  layout.yaxis.gridcolor = color_scheme_layout[scheme].gridcolor;
  layout.xaxis.gridcolor = color_scheme_layout[scheme].gridcolor;
  layout.font.color = color_scheme_layout[scheme].font_color;
}


if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").onchange = (change) => {
    isDarkMode = change.matches;
    // CpuTempTraces[0].line.color = isDarkMode ? "#fff" : "#000";
    CpuUtilTraces[NUM_CPU_CORES].line.color = isDarkMode ? "#fff" : "#000";
    UpdatePlotColors(isDarkMode ? "dark" : "light");
    Plotly.redraw("Plot-Area");
  };
}

function SelectSensorFromMenu(sensor) {
  SelectSensor(sensor);
  if (trace == "CPU_temp") {
    ChangePlot(0, trace);
  }
}

function SelectSensor(sensor) {
  sensor_to_show = sensor;

  Traces.CPU_temp = [...Array.from(Array(Object.keys(temp_sensors[sensor_to_show][HISTORY_LAST]).length).keys(), i => {
    // const name = temp_sensors[sensor_to_show][HISTORY_LAST].length == 1 ? `${sensor_to_show}` : `${sensor_to_show} ${i}`;
    let nameAv = '';
    let nameMax = '';
    if (temp_sensors[sensor_to_show][HISTORY_LAST].length == 1) {
      nameMax = `${sensor_to_show}: ${temp_sensors[sensor_to_show][HISTORY_LAST][0]}° C`;
    } else {
      nameMax = `max: ${Math.max(...temp_sensors[sensor_to_show][HISTORY_LAST])}° C`;
      nameAv = `av: ${Math.round(temp_sensors[sensor_to_show][HISTORY_LAST].reduce((a,b) => a+b) / temp_sensors[sensor_to_show][HISTORY_LAST].length)}° C`;
    }
    return {
      x: Object.keys(Array(HISTORY_SIZE).fill(null)).map(v => v*REFRESH_PERIOD).reverse(),
      y: temp_sensors[sensor_to_show].map(s => s ? s[i] : null),
      name: i == 0 ? nameMax : nameAv,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: temp_sensors[sensor_to_show][HISTORY_LAST].length > 2 ? 1 : 3
      },
      showlegend: temp_sensors[sensor_to_show][HISTORY_LAST].length == 1 || i < 2
    };
  })];
}

function DiskSelectFromMenu(disk) {
  DiskSelect(disk);
  if (trace == "Disk_io") {
    ChangePlot(0, trace);
  }
}

function DiskSelect(disk) {
  disk_to_show = disk;

  if (trace == "Disk_io") {
    update_disk_io_trace();

    if (layout_config.Disk_io.y_axis_max < 1) {
      disk_io_unit = disk_io_unit === "GB" ? "MB" : disk_io_unit === "MB" ? "KB" : disk_io_unit === "KB" ? "B" : "B";
      update_disk_io_trace();
    } else if (layout_config.Disk_io.y_axis_max > 1024) {
      disk_io_unit = disk_io_unit === "B" ? "KB" : disk_io_unit === "KB" ? "MB" : disk_io_unit === "MB" ? "GB" : "GB";
      update_disk_io_trace();
    }

    layout_config.Disk_io.y_axis_max = layout_config.Disk_io.y_axis_max * 1.25;
    layout_config.Disk_io.y_title = `Disk IO (${disk_io_unit}ps)`;
  }
}


// ----------------------------------------------------


const sio = io()

const heartbeat_colors = ["red", "green"];
var status_count = true;
const indicator_el = document.getElementById("heartbeat-indicator");
const host_uptime = document.getElementById("host_uptime");

sio.on("connect", () => {
  console.log("connected");
});

sio.on("client_count", (host) => {
  document.getElementById("active_client_count").innerText = host.count;
});

sio.on("status_init", (init) => {
  document.title = `${init.Hostname}`;
  document.getElementById("footer").innerText = `Hostname: ${init.Hostname}`;

  NUM_CPU_CORES = init.CPU_Util.length;
  sensor_to_show = Object.keys(init.CPU_Temp).sort()[0];

  NUM_CPU_PACKAGES = Object.keys(init.CPU_Temp).length;

  disk_to_show = Object.keys(init.Disk_IO).sort()[0];

  REFRESH_PERIOD = init.Refresh_Period;
  HISTORY_SIZE = Math.floor(HISTORY_TIME / REFRESH_PERIOD);
  HISTORY_LAST = HISTORY_SIZE - 1;

  time = Object.keys(Array(HISTORY_SIZE).fill(null)).map(v => v*REFRESH_PERIOD).reverse();

  mem_util = {
    ram: Array(HISTORY_SIZE).fill(null),
    swap: Array(HISTORY_SIZE).fill(null),
  };
  MemTraces = [
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: "RAM",
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: 3
      }
    },
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: "Swap",
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: 3
      },
    }
  ];

  CpuUtilTraces = [
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: "CPU avg",
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: 3,
        color: "#000"
      },
    },
    ...Array.from(Array(NUM_CPU_CORES).keys(), i => {
      return {
        x: time,
        y: Array(HISTORY_SIZE).fill(null),
        name: `Core ${i}`,
        line: {
          shape: LINE_SHAPE,
          smoothing: LINE_SMOOTHING,
          width: 1
        },
      };
    })
  ].reverse();

  CpuTempTraces = [...Array.from(Array(init.CPU_Temp[sensor_to_show].length).keys(), i => {
    return {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: init.CPU_Temp[sensor_to_show].length == 1 ? `${sensor_to_show}` : `${sensor_to_show} ${i}`,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: init.CPU_Temp[sensor_to_show].length > 2 ? 1 : 3,
        // color: "#000"
      },
      showlegend: true
    };
  })];


  DiskIoTraces = [
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: `Read`,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: 3,
      },
    },
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: `Write`,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: 3,
      },
    }
  ];

  network_io = {
    tx: Array(HISTORY_SIZE).fill(null),
    rx: Array(HISTORY_SIZE).fill(null),
  };
  NetworkIoTraces = [
   {
     x: time,
     y: Array(HISTORY_SIZE).fill(null),
     name: "Tx",
     line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: 3
     },
     showlegend: true,
   },
   {
     x: time,
     y: Array(HISTORY_SIZE).fill(null),
     name: "Rx",
     line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: 3
     },
     showlegend: true,
   },
 ];

  Traces = {
    CPU_util: CpuUtilTraces,
    Memory: MemTraces,
    CPU_temp: CpuTempTraces,
    Network_io: NetworkIoTraces,
    Disk_io: DiskIoTraces,
  };

  temp_sensors = { };
  Array.from(document.getElementById("sensor-selector").children).map(o => o.remove());
  for (let sensor of Object.keys(init.CPU_Temp).sort()) {
    temp_sensors[sensor] = [
      Array(HISTORY_SIZE).fill(Array(NUM_CPU_PACKAGES).fill(null))
    ];
    const sensor_option = document.createElement("option");
    sensor_option.value = sensor;
    sensor_option.textContent = sensor;
    document.getElementById("sensor-selector").appendChild(sensor_option);
  }

  Array.from(document.getElementById("disk-selector").children).map(o => o.remove());
  for (let disk of Object.keys(init.Disk_IO).sort()) {
    disk_io[disk] = {
      read: Array(HISTORY_SIZE).fill(null),
      write: Array(HISTORY_SIZE).fill(null),
    };

    const disk_option = document.createElement("option");
    disk_option.value = disk;
    disk_option.innerText = disk;
    document.getElementById("disk-selector").appendChild(disk_option);

    all_disks.splice(all_disks.length, 0, disk);
  }

  Up_Time = init.Up_Time;

  init_done = 1;  // done

  UpdatePlotColors(isDarkMode ? "dark" : "light");
  ChangePlot(0, trace);
});

function update_disk_io_trace() {
  DiskIoTraces[0].y = disk_io[disk_to_show].read.map(v => v === null ? v : v/CONVERSION_FROM_B[disk_io_unit] / REFRESH_PERIOD);
  DiskIoTraces[1].y = disk_io[disk_to_show].write.map(v => v === null ? v : v/CONVERSION_FROM_B[disk_io_unit] / REFRESH_PERIOD);

  DiskIoTraces[0].name = `R: ${DiskIoTraces[0].y[HISTORY_LAST].toFixed(1)} ${disk_io_unit}ps`;
  DiskIoTraces[1].name = `W: ${DiskIoTraces[1].y[HISTORY_LAST].toFixed(1)} ${disk_io_unit}ps`;

  layout_config.Disk_io.y_axis_max = Math.max(
    0.8, ...DiskIoTraces[0].y, ...DiskIoTraces[1].y
  );
}
const DiskIoGhost = document.getElementById("disk-ghost");
function update_Disk_io({Disk_IO}) {
  for (let disk of Object.keys(Disk_IO).sort()) {
    disk_io[disk].read.splice(0, HISTORY_LAST, ...disk_io[disk].read.slice(1, HISTORY_LAST));
    disk_io[disk].read[HISTORY_LAST] = Disk_IO[disk].read;
    disk_io[disk].write.splice(0, HISTORY_LAST, ...disk_io[disk].write.slice(1, HISTORY_LAST));
    disk_io[disk].write[HISTORY_LAST] = Disk_IO[disk].write;
  }

  update_disk_io_trace();
  if (layout_config.Disk_io.y_axis_max < 1) {
    disk_io_unit = disk_io_unit === "GB" ? "MB" : disk_io_unit === "MB" ? "KB" : disk_io_unit === "KB" ? "B" : "B";
    update_disk_io_trace();
  } else if (layout_config.Disk_io.y_axis_max > 1024) {
    disk_io_unit = disk_io_unit === "B" ? "KB" : disk_io_unit === "KB" ? "MB" : disk_io_unit === "MB" ? "GB" : "GB";
    update_disk_io_trace();
  }
  layout_config.Disk_io.y_axis_max = Math.max(0.8, layout_config.Disk_io.y_axis_max) * 1.25;

  const readText = `R: ${clip10(Disk_IO[disk_to_show].read / CONVERSION_FROM_B[disk_io_unit], 1)}${disk_io_unit}ps`;
  const writeText = `W: ${clip10(Disk_IO[disk_to_show].write / CONVERSION_FROM_B[disk_io_unit], 1)}${disk_io_unit}ps`;
  const ghostTxt = Disk_IO[disk_to_show].read == 0 && Disk_IO[disk_to_show].write == 0 ? `Idle` : Disk_IO[disk_to_show].read > Disk_IO[disk_to_show].write ? readText : writeText;
  DiskIoGhost.innerText = ghostTxt;
}

// const CpuTempGhost = document.getElementById("cpu_temp-ghost");
function update_CPU_temp({CPU_Temp}) {
  const current_sensors = Object.keys(temp_sensors);
  Object.keys(CPU_Temp).map((sensor) => {
    if (current_sensors.includes(sensor)) {
      temp_sensors[sensor].splice(0, HISTORY_LAST, ...temp_sensors[sensor].slice(1, HISTORY_LAST));
    } else {
      temp_sensors[sensor] = Array(HISTORY_SIZE).fill(null);
    }
    temp_sensors[sensor][HISTORY_LAST] = CPU_Temp[sensor];
  });
  for (let i in Traces.CPU_temp) {
    Traces.CPU_temp[i].y = temp_sensors[sensor_to_show].map(s => s ? s[i] : null);
    if (CPU_Temp[sensor_to_show].length == 1) {
      Traces.CPU_temp[0].name = `${sensor_to_show}: ${Math.round(CPU_Temp[sensor_to_show][0])}° C`
    } else {
      Traces.CPU_temp[0].name = `max: ${Math.max(...CPU_Temp[sensor_to_show])}° C`
      Traces.CPU_temp[1].name = `av: ${Math.round(CPU_Temp[sensor_to_show].reduce((a,b) => a+b) / CPU_Temp[sensor_to_show].length)}° C`
      for (i in Object.keys(Array(CPU_Temp[sensor_to_show].length - 2).fill(0))) {
        Traces.CPU_temp[i - -2].showlegend = false;
      }
    }
  }
}

const CpuUtilGhost = document.getElementById("cpu_util-ghost");
function update_CPU_util({CPU_Util}) {
  for (let cpu_key in Array(NUM_CPU_CORES).fill(0)) {
    CpuUtilTraces[cpu_key].name = `Core ${cpu_key}: ${CPU_Util[cpu_key].toFixed(1)}%`;
    CpuUtilTraces[cpu_key].showlegend = false;
    CpuUtilTraces[cpu_key].y.splice(0, HISTORY_LAST, ...CpuUtilTraces[cpu_key].y.slice(1, HISTORY_LAST));
    CpuUtilTraces[cpu_key].y[HISTORY_LAST] = CPU_Util[cpu_key];
  }

  const cpu_util_av = (CPU_Util.reduce((a, b) => a - -b)/NUM_CPU_CORES);
  CpuUtilTraces[NUM_CPU_CORES].name = `CPU avg: ${cpu_util_av.toFixed(1)}%`;
  CpuUtilTraces[NUM_CPU_CORES].y.splice(0, HISTORY_LAST, ...CpuUtilTraces[NUM_CPU_CORES].y.slice(1, HISTORY_LAST));
  CpuUtilTraces[NUM_CPU_CORES].y[HISTORY_LAST] = cpu_util_av;

  const max_cpu_util = Object.keys(CPU_Util).reduce((a, b) => {
    return CPU_Util[a] > CPU_Util[b] ? a : b;
  });
  CpuUtilTraces[max_cpu_util].showlegend = true;

  CpuUtilGhost.innerText = `${clip10(cpu_util_av, 1)}%`;
}

function update_memory_trace() {
  MemTraces[0].y = mem_util.ram.map(v => v===null ? v : parseFloat(v) / CONVERSION_FROM_B[memory_unit]);
  MemTraces[0].name = `RAM: ${MemTraces[0].y[HISTORY_LAST].toFixed(1)} ${memory_unit}`;
  MemTraces[1].y = mem_util.swap.map(v => v===null ? v : parseFloat(v) / CONVERSION_FROM_B[memory_unit]);
  MemTraces[1].name = `Swap: ${MemTraces[1].y[HISTORY_LAST].toFixed(1)} ${memory_unit}`;
  layout_config.Memory.y_axis_max = Math.max(...mem_util.ram, ...mem_util.swap) / CONVERSION_FROM_B[memory_unit];
}
const MemoryUtilGhost = document.getElementById("mem-ghost");
function update_Memory({Memory}) {
  mem_util.ram.splice(0, HISTORY_LAST, ...mem_util.ram.slice(1, HISTORY_LAST));
  mem_util.ram[HISTORY_LAST] = Memory.RAM;
  mem_util.swap.splice(0, HISTORY_LAST, ...mem_util.swap.slice(1, HISTORY_LAST));
  mem_util.swap[HISTORY_LAST] = Memory.Swap;
  update_memory_trace();
  if (layout_config.Memory.y_axis_max < 1) {
    memory_unit = memory_unit === "GB" ? "MB" : memory_unit === "MB" ? "KB" : memory_unit === "KB" ? "B" : "B";
    update_memory_trace();
  } else if (layout_config.Memory.y_axis_max > 1024) {
    memory_unit = memory_unit === "B" ? "KB" : memory_unit === "KB" ? "MB" : memory_unit === "MB" ? "GB" : "GB";
    update_memory_trace();
  }
  layout_config.Memory.y_axis_max = layout_config.Memory.y_axis_max * 1.25;

  let MemUtilGhostText = mem_util.ram[HISTORY_LAST] / CONVERSION_FROM_B[memory_unit];
  MemUtilGhostText = MemUtilGhostText < 10 ? MemUtilGhostText.toFixed(1) : MemUtilGhostText.toFixed(0);
  MemoryUtilGhost.innerText = `${MemUtilGhostText}${memory_unit}`;
}

function update_network_io_trace() {
  NetworkIoTraces[0].y = network_io.tx.map(x => x === null ? null : x/CONVERSION_FROM_B[network_io_unit] / REFRESH_PERIOD);
  NetworkIoTraces[1].y = network_io.rx.map(x => x === null ? null : x/CONVERSION_FROM_B[network_io_unit] / REFRESH_PERIOD);
  NetworkIoTraces[0].name = `Tx: ${NetworkIoTraces[0].y[HISTORY_LAST].toFixed(1)} ${network_io_unit}ps`;
  NetworkIoTraces[1].name = `Rx: ${NetworkIoTraces[1].y[HISTORY_LAST].toFixed(1)} ${network_io_unit}ps`;
  layout_config.Network_io.y_axis_max = Math.max(
    ...NetworkIoTraces[0].y,
    ...NetworkIoTraces[1].y,
  );
}
const NetGhost = document.getElementById("net-ghost");
function update_Neteork_io({Network_IO}) {
  network_io.tx.splice(0, HISTORY_LAST, ...network_io.tx.slice(1, HISTORY_LAST));
  network_io.rx.splice(0, HISTORY_LAST, ...network_io.rx.slice(1, HISTORY_LAST));
  network_io.tx[HISTORY_LAST] = parseFloat(Network_IO.tx);
  network_io.rx[HISTORY_LAST] = parseFloat(Network_IO.rx);
  update_network_io_trace();
  if (layout_config.Network_io.y_axis_max < 1) {
    network_io_unit = network_io_unit === "GB" ? "MB" : network_io_unit === "MB" ? "KB" : network_io_unit === "KB" ? "B" : "B";
    update_network_io_trace();
  } else if (layout_config.Network_io.y_axis_max > 1024) {
    network_io_unit = network_io_unit === "B" ? "KB" : network_io_unit === "KB" ? "MB" : network_io_unit === "MB" ? "GB" : "GB";
    update_network_io_trace();
  }
  layout_config.Network_io.y_axis_max = layout_config.Network_io.y_axis_max * 1.25;

  const rxGhost = clip10(network_io.rx[HISTORY_LAST] / CONVERSION_FROM_B[network_io_unit], 1);
  const txGhost = clip10(network_io.tx[HISTORY_LAST] / CONVERSION_FROM_B[network_io_unit], 1);
  const ghostTxt = rxGhost > txGhost ? `↓ ${rxGhost}` : `↑ ${txGhost}`;
  NetGhost.innerText = `${ghostTxt}${network_io_unit}ps`;
}

function do_blink() {
  status_count = !status_count;

  indicator_el.style.backgroundColor = heartbeat_colors[status_count%2];
  setTimeout(() => {
    status_count = !status_count;
    indicator_el.style.backgroundColor = heartbeat_colors[status_count%2];
  }, REFRESH_PERIOD * 1000/2);

  host_uptime.innerText = formatTime(Up_Time);
  Up_Time += 1;
}

const MINS_TO_SECS = 60;
const HRS_TO_SECS = MINS_TO_SECS * 60;
const DAYS_TO_SECS = HRS_TO_SECS * 24;
const WEEKS_TO_SECS = DAYS_TO_SECS * 7;
const YRS_TO_SECS = WEEKS_TO_SECS * 52 + DAYS_TO_SECS * (2.2475);
const uptime_factorised = {}

function formatTime(uptime) {
  let cum_uptime = uptime;

  uptime_factorised.y = Math.floor(cum_uptime / YRS_TO_SECS);
  cum_uptime -= uptime_factorised.y * YRS_TO_SECS;

  uptime_factorised.w = Math.floor(cum_uptime / WEEKS_TO_SECS);
  cum_uptime -= uptime_factorised.w * WEEKS_TO_SECS;

  uptime_factorised.d = Math.floor(cum_uptime / DAYS_TO_SECS);
  cum_uptime -= uptime_factorised.d * DAYS_TO_SECS;

  uptime_factorised.h = Math.floor(cum_uptime / HRS_TO_SECS);
  cum_uptime -= uptime_factorised.h * HRS_TO_SECS;

  uptime_factorised.m = Math.floor(cum_uptime / MINS_TO_SECS);
  cum_uptime -= uptime_factorised.m * MINS_TO_SECS;

  uptime_factorised.s = cum_uptime;

  time_units = ['y', 'w', 'd', 'h', 'm', 's'];
  const uptime_factors_to_show = [": "]

  for (unit of time_units) {
    if (uptime_factorised[unit]) {
      uptime_factors_to_show.splice(uptime_factors_to_show.length, 0, `${uptime_factorised[unit]}${unit}`);
    }
    if (uptime_factors_to_show.length >= 3) {
      return uptime_factors_to_show.join(" ");
    }
  }
  return uptime_factors_to_show.join(" ");
}

sio.on("status_update", (status) => {
  status_count = false;
  do_blink();

  isDarkMode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (init_done == 1) {

    switch (trace) {
      case "CPU_temp":
        update_CPU_temp(status);
        break;

      case "CPU_util":
        update_CPU_util(status);
        break;

      case "Disk_io":
        update_Disk_io(status);
        layout.yaxis.range = [0, Math.max(1, layout_config.Disk_io.y_axis_max)];
        layout.yaxis.title = `Disk IO (${disk_io_unit}ps)`;
        break;

      case "Memory":
        update_Memory(status);
        layout.yaxis.range = [0, Math.max(1, layout_config.Memory.y_axis_max)];
        layout.yaxis.title = `Util (${memory_unit})`;
        break;

      case "Network_io":
        update_Neteork_io(status);
        layout.yaxis.range = [0, Math.max(1, layout_config.Network_io.y_axis_max)];
        layout.yaxis.title = `Net IO (${network_io_unit}ps)`;
        break;
    }
    Plotly.redraw("Plot-Area");

    for (let resource of Object.keys(layout_config)) {
      if (resource !== trace) {
        layout_config[resource].updator(status);
      }
    }
  }
});

// ----------------------------------------------------

let view = 1;
const views = [
  'CPU_util',
  'Memory',
  'Network_io',
  'CPU_temp',
  'Disk_io'
]

document.onkeydown = ((event) => {
  switch (event.key) {
    case "1":
      view = 1;
      ChangePlot(0, 'CPU_util');
      break;

    case "2":
      view = 2;
      ChangePlot(0, 'Memory');
      break;

    case "3":
      view = 3;
      ChangePlot(0, 'Network_io');
      break;

    case "4":
      view = 4;
      if (trace == 'CPU_temp') {
        sensor_to_show = Object.keys(temp_sensors).sort()[(Object.keys(temp_sensors).sort().indexOf(sensor_to_show) + 1) % Object.keys(temp_sensors).length];
        SelectSensor(sensor_to_show);
        document.getElementById("sensor-selector").value = sensor_to_show;
      }
      ChangePlot(0, 'CPU_temp');
      break;

    case "$":
      view = 4;
      if (trace == 'CPU_temp') {
        sensor_to_show = Object.keys(temp_sensors).sort()[(Object.keys(temp_sensors).sort().indexOf(sensor_to_show) - 1 + Object.keys(temp_sensors).length) % Object.keys(temp_sensors).length];
        SelectSensor(sensor_to_show);
        document.getElementById("sensor-selector").value = sensor_to_show;
      }
      ChangePlot(0, 'CPU_temp');
      break;
  
    case "5":
      view = 5;
      if (trace == 'Disk_io') {
        disk_to_show = all_disks[(all_disks.indexOf(disk_to_show) + 1) % all_disks.length];
        DiskSelect(disk_to_show);
        document.getElementById("disk-selector").value = disk_to_show;
      }
      ChangePlot(0, 'Disk_io');
      break;

    case "%":
      view = 5;
      if (trace == 'Disk_io') {
        disk_to_show = all_disks[(all_disks.indexOf(disk_to_show) + all_disks.length - 1) % all_disks.length];
        DiskSelect(disk_to_show);
        document.getElementById("disk-selector").value = disk_to_show;
      }
      ChangePlot(0, 'Disk_io');
      break;

    case "`":
      view = (view % views.length) + 1;
      ChangePlot(0, views[view-1]);
      break;

    case "~":
      view = ((view - 1) % views.length);
      view = view ? view : views.length;
      ChangePlot(0, views[(view-1)]);
      break;
  }
});
