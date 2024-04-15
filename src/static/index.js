let NUM_CPU_PACKAGES;
let NUM_CPU_CORES;
let MAX_RAM_SIZE;

const LINE_SHAPE = "spline";   // "linear";
const LINE_SMOOTHING = 1.0;    // Has an effect only if `shape` is set to "spline". Sets the amount of smoothing.
                               // "0" corresponds to no smoothing (equivalent to a "linear" shape).
const LINE_WIDTH_THIN = 1;
const LINE_WIDTH_NORMAL = 2;
const LINE_WIDTH_THICK = 3;

const HISTORY_TIME = 31;       // seconds
const CONVERSION_FROM_B = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024
}
const STORAGE_SIZE = ["B", "KB", "MB", "GB"];

const CPU_UTIL_TAG = ["Avg", "Core"];
const MEMORY_TAG = ["RAM", "Swap"];
const NET_IO_TAGS = ["Tx", "Rx"];
const SENSOR_TAGS = ["Max", "Avg"];
const DISK_IO_TAGS = ["R", "W"];

function bisectRight(val, maps) {
  /*
    bisectRight(0, {a:1, b:3, c:5}) -> a
    bisectRight(1, {a:1, b:3, c:5}) -> b
    bisectRight(2, {a:1, b:3, c:5}) -> b
    bisectRight(3, {a:1, b:3, c:5}) -> c
    bisectRight(4, {a:1, b:3, c:5}) -> c
    bisectRight(5, {a:1, b:3, c:5}) -> c
    bisectRight(6, {a:1, b:3, c:5}) -> c
  */
  const labels = Object.keys(maps).sort((a, b) => maps[a] - maps[b])
  const eligible = labels.filter(l => maps[l] > val);
  return eligible[0] == undefined ? labels[labels.length - 1] : eligible[0];
}

function bisectLeft(val, maps) {
  /*
    bisectLeft(0, {a:1, b:3, c:5}) -> "a"
    bisectLeft(1, {a:1, b:3, c:5}) -> "a"
    bisectLeft(2, {a:1, b:3, c:5}) -> "a"
    bisectLeft(3, {a:1, b:3, c:5}) -> "a"
    bisectLeft(4, {a:1, b:3, c:5}) -> "b"
    bisectLeft(5, {a:1, b:3, c:5}) -> "b"
    bisectLeft(6, {a:1, b:3, c:5}) -> "c"
  */
  const labels = Object.keys(maps).sort((a, b) => maps[a] - maps[b])
  const eligible = labels.filter(l => maps[l] < val);
  return eligible[0] == undefined ? labels[0] : eligible[eligible.length - 1];
}

const YAXIS_MAX_MULTIPLIER = 1.25;
const YAXIS_MIN = 1 / YAXIS_MAX_MULTIPLIER;

let trace = "CPU_util";
let isDarkMode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

let disk_to_show;

let init_done = 0;        // not done
let REFRESH_PERIOD;  // s
let BLINK_PERIOD;  // s
let HISTORY_SIZE;
let HISTORY_LAST;

// const PLOTLY_COLORS = [
//   "#1f77b4",  // muted blue
//   "#ff7f0e",  // safety orange
//   "#2ca02c",  // cooked asparagus green
//   "#d62728",  // brick red
//   "#9467bd",  // muted purple
//   "#8c564b",  // chestnut brown
//   "#e377c2",  // raspberry yogurt pink
//   "#7f7f7f",  // middle gray
//   "#bcbd22",  // curry yellow-green
//   "#17becf"   // blue-teal
// ]


function clip10(c, n) {
  if (c > 10 || n == 0) {
    return Math.round(c);
  } else {
    return (Math.round(c * 10**n) * 10**-n).toFixed(n);
  }
}

function formatStr(str, replacements) {
  for (let replacement of replacements) {
    str = str.replace("{}", replacement);
  }
  return str;
}

// ----------------------------------------------------


let network_io_unit = "KB";
let tx_io_unit = "KB";
let rx_io_unit = "KB";

let disk_io_unit = "MB";
let read_io_unit = "MB";
let write_io_unit = "MB";

let memory_unit = "GB"
let ram_unit = "GB"
let swap_unit = "GB"

const layout_config = {
  CPU_util: {
    chart_title: "CPU Util",
    y_title: "Util (%)",
    y_axis_max: 100,
    legend_traceorder: "reversed",
    updator: update_CPU_util,
    units: () => [],
  },
  Memory: {
    chart_title: "Memory",
    // y_title: "Util (GB)",
    y_title: "Util ({})",
    y_axis_max: MAX_RAM_SIZE,
    legend_traceorder: "normal",
    updator: update_Memory,
    units: () => [memory_unit, ],
  },
  Network_io: {
    chart_title: "Network IO",
    // y_title: `Net IO (${network_io_unit}ps)`,
    y_title: "Net IO ({}ps)",
    y_axis_max: 1024,
    legend_traceorder: "normal",
    updator: update_Network_io,
    units: () => [network_io_unit, ],
  },
  CPU_temp: {
    chart_title: "Temperature",
    y_title: "Temp (°C)",
    y_axis_max: 100,
    legend_traceorder: "normal",
    updator: update_CPU_temp,
    units: () => [],
  },
  Disk_io: {
    chart_title: "Disk IO",
    // y_title: `Disk IO (${disk_io_unit}ps)`,
    y_title: "Disk IO ({}ps)",
    y_axis_max: 10,
    legend_traceorder: "normal",
    updator: update_Disk_io,
    units: () => [network_io_unit, ],
  },
  Meross_power: {
    chart_title: "Power Draw",
    y_title: "Power (w)",
    y_axis_max: 250,
    legend_traceorder: "normal",
    updator: update_Meross_power,
    units: () => [],
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

let meross_power_to_show;
let all_sensors = [ ];
let meross_power = [ ];
let MerossPowerTraces = [ ]

let Traces = {
  CPU_util: CpuUtilTraces,
  Memory: MemTraces,
  CPU_temp: CpuTempTraces,
  Network_io: NetworkIoTraces,
  Disk_io: DiskIoTraces,
  Meross_power: MerossPowerTraces,
};

const layout = {
  title: {
    text: "CPU Temp",
    font: {
      size: 25
    },
  },
  plot_bgcolor: "#fff",
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
  },
  // colorway: PLOTLY_COLORS
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
  "Meross_power": "meross-power",
}

function ChangePlot(event, key) {
  if ((event != 0 && ["select", "option"].includes(event.target.nodeName.toLowerCase()))) {
    return;
  }
  view = views.indexOf(key)+1;
  trace = key;
  layout.title.text = layout_config[key].chart_title;
  layout.yaxis.title = formatStr(layout_config[trace].y_title, layout_config[trace].units());
  layout.yaxis.range[1] = layout_config[key].y_axis_max;
  layout.legend.traceorder = layout_config[key].legend_traceorder;

  for (const element of document.getElementsByClassName("navigator-targets")) {
    if (element.classList.contains(eventNameMapping[key])) {
      element.style.border = "1px solid var(--active-border)";
      element.style.backgroundColor = "var(--active-cell)";
    } else {
      element.style.border = "1px solid var(--inactive-border)";
      element.style.backgroundColor = "var(--inactive-cell)";
    }
  }

  Plotly.newPlot("Plot-Area", Traces[key], layout, {
    staticPlot: true,
    responsive: true
  });
}

function UpdatePlotColors(scheme) {
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
    UpdatePlotColors(isDarkMode ? "dark" : "light");
    Plotly.redraw("Plot-Area");
  };
}

// ----------------------------------------------------

function SelectSensorFromMenu(sensor) {
  SelectSensor(sensor);
  if (trace == "CPU_temp") {
    ChangePlot(0, trace);
  }
}
function SelectSensor(sensor) {
  sensor_to_show = sensor;

  Traces.CPU_temp = [...Array.from(Array(Object.keys(temp_sensors[sensor_to_show][HISTORY_LAST]).length).keys(), i => {
    const NUM_TEMP_SENSORS = temp_sensors[sensor_to_show][HISTORY_LAST].length;
    let nameMax = "";
    let nameAv = "";
    if (NUM_TEMP_SENSORS > 2) {
      nameMax = `${SENSOR_TAGS[0]}: ${Math.ceil(Math.max(...temp_sensors[sensor_to_show][HISTORY_LAST]))}° C`;
      nameAv = `${SENSOR_TAGS[1]}: ${Math.round(temp_sensors[sensor_to_show][HISTORY_LAST].reduce((a,b) => a+b) / NUM_TEMP_SENSORS)}° C`;
    } else {
      nameMax = `${sensor_to_show} ${i}: ${Math.round(temp_sensors[sensor_to_show][HISTORY_LAST][i])}° C`;
      nameAv = `${sensor_to_show} ${i}: ${Math.round(temp_sensors[sensor_to_show][HISTORY_LAST][i])}° C`;
    }

    return {
      x: Object.keys(Array(HISTORY_SIZE).fill(null)).map(v => v*REFRESH_PERIOD).reverse(),
      y: temp_sensors[sensor_to_show].map(s => s ? s[i] : null),
      name: i == 0 ? nameMax : nameAv,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: NUM_TEMP_SENSORS > LINE_WIDTH_NORMAL ? LINE_WIDTH_NORMAL : LINE_WIDTH_THICK,
      },
      showlegend: (NUM_TEMP_SENSORS <= 2) || (NUM_TEMP_SENSORS > 2 && i < 2)
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

  disk_io_unit = bisectLeft(Math.max(
    YAXIS_MIN,
    ...disk_io[disk_to_show].read,
    ...disk_io[disk_to_show].write
  ), CONVERSION_FROM_B);
  read_io_unit = bisectLeft(Math.max(
    YAXIS_MIN, ...disk_io[disk_to_show].read
  ), CONVERSION_FROM_B);
  write_io_unit = bisectLeft(Math.max(
    YAXIS_MIN, ...disk_io[disk_to_show].write
  ), CONVERSION_FROM_B);

  update_disk_io_trace();
  layout_config.Disk_io.y_title = `Disk IO (${disk_io_unit}ps)`;

  const readText = `${DISK_IO_TAGS[0]}: ${clip10(disk_io[disk].read[HISTORY_LAST] / CONVERSION_FROM_B[disk_io_unit], 1)}${disk_io_unit}ps`;
  const writeText = `${DISK_IO_TAGS[1]}: ${clip10(disk_io[disk].write[HISTORY_LAST] / CONVERSION_FROM_B[disk_io_unit], 1)}${disk_io_unit}ps`;
  const ghostTxt = disk_io[disk].read[HISTORY_LAST] == 0 && disk_io[disk].write[HISTORY_LAST] == 0 ? `Idle` : disk_io[disk].read[HISTORY_LAST] > disk_io[disk].write[HISTORY_LAST] ? readText : writeText;
  DiskIoGhost.innerText = ghostTxt;
}


function MerossPowerSelectFromMenu(sensor) {
  MerossPowerSelect(sensor);
  if (trace == "Meross_power") {
    ChangePlot(0, trace);
  }
}
function MerossPowerSelect(sensor) {
  meross_power_to_show = sensor;
  update_meross_trace();

  const ghostTxt = clip10(meross_power[HISTORY_LAST][meross_power_to_show], 1);
  MerossGhost.innerText = `${ghostTxt}W`;
}

// ----------------------------------------------------


const sio = io();

const heartbeat_colors = ["red", "green"];
var status_count = true;
const indicator_el = document.getElementById("heartbeat-indicator");
const host_uptime = document.getElementById("host_uptime");

sio.on("connect", () => {
  console.log("connected");
});

sio.on("status_init", (init) => {
  document.title = `${init.Hostname}`;
  document.getElementById("footer").innerText = `Hostname: ${init.Hostname}`;

  NUM_CPU_CORES = init.CPU_Util.length;
  sensor_to_show = Object.keys(init.CPU_Temp).sort()[0];

  NUM_CPU_PACKAGES = Object.keys(init.CPU_Temp).length;

  disk_to_show = Object.keys(init.Disk_IO).sort()[0];

  BLINK_PERIOD = init.Refresh_Period;
  REFRESH_PERIOD = init.Time;
  HISTORY_SIZE = Math.floor(HISTORY_TIME / BLINK_PERIOD);
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
        width: LINE_WIDTH_THICK
      }
    },
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: "Swap",
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: LINE_WIDTH_THICK
      },
    }
  ];

  CpuUtilTraces = [
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: `${CPU_UTIL_TAG[0]}`,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: LINE_WIDTH_THICK,
        color: "#000"
      },
    },
    ...Array.from(Array(NUM_CPU_CORES).keys(), i => {
      return {
        x: time,
        y: Array(HISTORY_SIZE).fill(null),
        name: `${CPU_UTIL_TAG[1]} ${i}`,
        line: {
          shape: LINE_SHAPE,
          smoothing: LINE_SMOOTHING,
          width: LINE_WIDTH_THIN
        },
      };
    })
  ].reverse();

  CpuTempTraces = [...Array.from(Array(
    Object.keys(init.CPU_Temp[sensor_to_show]).length
  ).keys(), i => {
    return {
      x: Object.keys(Array(HISTORY_SIZE).fill(null)).map(v => v*REFRESH_PERIOD).reverse(),
      y: Array(HISTORY_SIZE).fill(null),
      name: `${sensor_to_show} ${i}`,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: init.CPU_Temp[sensor_to_show].length > LINE_WIDTH_NORMAL ? LINE_WIDTH_NORMAL : LINE_WIDTH_THICK,
      },
      showlegend: true
    };
  })];

  DiskIoTraces = [
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: "Read",
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: LINE_WIDTH_THICK,
      },
    },
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: "Write",
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: LINE_WIDTH_THICK,
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
      name: `${NET_IO_TAGS[0]}`,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: LINE_WIDTH_THICK
      },
      showlegend: true,
    },
    {
      x: time,
      y: Array(HISTORY_SIZE).fill(null),
      name: `${NET_IO_TAGS[1]}`,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: LINE_WIDTH_THICK
      },
      showlegend: true,
    },
  ];

  meross_power = Array(HISTORY_SIZE).fill(null);
  // meross_power[HISTORY_LAST] = init.Meross_Power
  meross_power_to_show = Object.keys(init.Meross_Power).sort()[0]

  MerossPowerTraces = [
    {
      x: time,
      y: Array(HISTORY_LAST).fill(null),
      name: `${meross_power_to_show}`,
      line: {
        shape: LINE_SHAPE,
        smoothing: LINE_SMOOTHING,
        width: LINE_WIDTH_THICK
      },
      showlegend: true
    }
  ]

  Traces = {
    CPU_util: CpuUtilTraces,
    Memory: MemTraces,
    CPU_temp: CpuTempTraces,
    Network_io: NetworkIoTraces,
    Disk_io: DiskIoTraces,
    Meross_power: MerossPowerTraces,
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

  all_sensors = [];
  Array.from(document.getElementById("meross-selector").children).map(o => o.remove());
  for (let sensor of Object.keys(init.Meross_Power).sort()) {
    const sensor_option = document.createElement("option");
    sensor_option.value = sensor;
    sensor_option.innerText = sensor;
    document.getElementById("meross-selector").appendChild(sensor_option);

    all_sensors.splice(all_sensors.length, 0, sensor);
  }

  Up_Time = init.Up_Time;

  init_done = 1;       // done

  UpdatePlotColors(isDarkMode ? "dark" : "light");
  ChangePlot(0, trace);
});

function update_disk_io_trace() {
  disk_io_unit = bisectLeft(Math.max(
    YAXIS_MIN,
    ...disk_io[disk_to_show].read,
    ...disk_io[disk_to_show].write
  ), CONVERSION_FROM_B);

  DiskIoTraces[0].y = disk_io[disk_to_show].read.map(v => v === null ? v : v/CONVERSION_FROM_B[disk_io_unit] / REFRESH_PERIOD);
  DiskIoTraces[1].y = disk_io[disk_to_show].write.map(v => v === null ? v : v/CONVERSION_FROM_B[disk_io_unit] / REFRESH_PERIOD);

  DiskIoTraces[0].name = `${DISK_IO_TAGS[0]}: ${(disk_io[disk_to_show].read[HISTORY_LAST]/CONVERSION_FROM_B[read_io_unit]).toFixed(1)} ${read_io_unit}ps`;
  DiskIoTraces[1].name = `${DISK_IO_TAGS[1]}: ${(disk_io[disk_to_show].write[HISTORY_LAST]/CONVERSION_FROM_B[write_io_unit]).toFixed(1)} ${write_io_unit}ps`;

  layout_config.Disk_io.y_axis_max = Math.max(
    YAXIS_MIN, ...DiskIoTraces[0].y, ...DiskIoTraces[1].y
  ) * YAXIS_MAX_MULTIPLIER;
}
const DiskIoGhost = document.getElementById("disk-ghost");
function update_Disk_io({Disk_IO}) {
  const new_disks = Object.keys(Disk_IO).filter(d => !Object.keys(disk_io).includes(d));
  const missing_disks = Object.keys(disk_io).filter(d => !Object.keys(Disk_IO).includes(d));

  if (new_disks.length) {
    for (let disk of new_disks) {
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
  }

  if (missing_disks.length) {
    for (let disk of missing_disks) {
      delete disk_io[disk];
      const current_disks = document.getElementById("disk-selector").children;
      current_disks[Array.from(current_disks).map(o => o.value).indexOf(disk)].remove();
      all_disks.splice(all_disks.indexOf(disk), 1);
      if (disk_to_show == disk) {
        disk_to_show = all_disks[0];
        document.getElementById("disk-selector").value = disk_to_show;
      }
    }
  }

  for (let disk of Object.keys(disk_io).sort()) {
    disk_io[disk].read.splice(0, HISTORY_LAST, ...disk_io[disk].read.slice(1, HISTORY_LAST));
    disk_io[disk].write.splice(0, HISTORY_LAST, ...disk_io[disk].write.slice(1, HISTORY_LAST));
    disk_io[disk].read[HISTORY_LAST] = Disk_IO[disk].read;
    disk_io[disk].write[HISTORY_LAST] = Disk_IO[disk].write;
  }

  read_io_unit = bisectLeft(Math.max(
    YAXIS_MIN, ...disk_io[disk_to_show].read
  ), CONVERSION_FROM_B);
  write_io_unit = bisectLeft(Math.max(
    YAXIS_MIN, ...disk_io[disk_to_show].write
  ), CONVERSION_FROM_B);
  update_disk_io_trace();

  const readText = `${DISK_IO_TAGS[0]}: ${clip10(Disk_IO[disk_to_show].read / CONVERSION_FROM_B[read_io_unit], 1)}${read_io_unit}ps`;
  const writeText = `${DISK_IO_TAGS[1]}: ${clip10(Disk_IO[disk_to_show].write / CONVERSION_FROM_B[write_io_unit], 1)}${write_io_unit}ps`;
  const ghostTxt = Disk_IO[disk_to_show].read == 0 && Disk_IO[disk_to_show].write == 0 ? "Idle" : Disk_IO[disk_to_show].read > Disk_IO[disk_to_show].write ? readText : writeText;
  DiskIoGhost.innerText = ghostTxt;
}

function update_CPU_temp({CPU_Temp}) {
  Object.keys(CPU_Temp).map((sensor) => {
    temp_sensors[sensor].splice(0, HISTORY_LAST, ...temp_sensors[sensor].slice(1, HISTORY_LAST));
    temp_sensors[sensor][HISTORY_LAST] = CPU_Temp[sensor];
  });

  if (CPU_Temp[sensor_to_show].length > 2) {
    Traces.CPU_temp[0].name = `${SENSOR_TAGS[0]}: ${Math.ceil(Math.max(...temp_sensors[sensor_to_show][HISTORY_LAST]))}° C`;
    Traces.CPU_temp[1].name = `${SENSOR_TAGS[1]}: ${Math.round(
      CPU_Temp[sensor_to_show].reduce((a,b) => a+b) / CPU_Temp[sensor_to_show].length
    )}° C`;
    for (let i in CPU_Temp[sensor_to_show]) {
      Traces.CPU_temp[i].y = temp_sensors[sensor_to_show].map(s => s ? s[i] : s);
    }
  } else {
    for (let i in CPU_Temp[sensor_to_show]) {
      Traces.CPU_temp[i].name = `${sensor_to_show} ${i}: ${Math.round(CPU_Temp[sensor_to_show][i])}° C`;
      Traces.CPU_temp[i].y = temp_sensors[sensor_to_show].map(s => s ? s[i] : s);
    }
  }
}

const CpuUtilGhost = document.getElementById("cpu_util-ghost");
function update_CPU_util({CPU_Util}) {
  for (let cpu_key in Array(NUM_CPU_CORES).fill(0)) {
    CpuUtilTraces[cpu_key].name = `${CPU_UTIL_TAG[1]} ${cpu_key}: ${CPU_Util[cpu_key].toFixed(1)}%`;
    CpuUtilTraces[cpu_key].showlegend = false;
    CpuUtilTraces[cpu_key].y.splice(0, HISTORY_LAST, ...CpuUtilTraces[cpu_key].y.slice(1, HISTORY_LAST));
    CpuUtilTraces[cpu_key].y[HISTORY_LAST] = CPU_Util[cpu_key];
  }

  const cpu_util_av = (CPU_Util.reduce((a, b) => a - -b)/NUM_CPU_CORES);
  CpuUtilTraces[NUM_CPU_CORES].name = `${CPU_UTIL_TAG[0]}: ${cpu_util_av.toFixed(1)}%`;
  CpuUtilTraces[NUM_CPU_CORES].y.splice(0, HISTORY_LAST, ...CpuUtilTraces[NUM_CPU_CORES].y.slice(1, HISTORY_LAST));
  CpuUtilTraces[NUM_CPU_CORES].y[HISTORY_LAST] = cpu_util_av;

  const max_cpu_util = Object.keys(CPU_Util).reduce((a, b) => {
    return CPU_Util[a] > CPU_Util[b] ? a : b;
  });
  CpuUtilTraces[max_cpu_util].showlegend = true;

  CpuUtilGhost.innerText = `${clip10(cpu_util_av, 1)}%`;
}

function update_memory_trace() {
  swap_unit = bisectLeft(Math.max(YAXIS_MIN, ...mem_util.swap), CONVERSION_FROM_B);
  memory_unit = bisectLeft(Math.max(YAXIS_MIN, ...mem_util.ram, ...mem_util.swap), CONVERSION_FROM_B);

  MemTraces[0].y = mem_util.ram.map(v => v===null ? v : parseFloat(v) / CONVERSION_FROM_B[memory_unit]);
  MemTraces[1].y = mem_util.swap.map(v => v===null ? v : parseFloat(v) / CONVERSION_FROM_B[memory_unit]);

  MemTraces[0].name = `${MEMORY_TAG[0]}: ${(parseFloat(mem_util.ram[HISTORY_LAST]) / CONVERSION_FROM_B[ram_unit]).toFixed(1)} ${ram_unit}`;
  MemTraces[1].name = `${MEMORY_TAG[1]}: ${(parseFloat(mem_util.swap[HISTORY_LAST]) / CONVERSION_FROM_B[swap_unit]).toFixed(1)} ${swap_unit}`;

  layout_config.Memory.y_axis_max = Math.max(
    ...mem_util.ram, ...mem_util.swap
  ) / CONVERSION_FROM_B[memory_unit]  * YAXIS_MAX_MULTIPLIER;
}
const MemoryUtilGhost = document.getElementById("mem-ghost");
function update_Memory({Memory}) {
  mem_util.ram.splice(0, HISTORY_LAST, ...mem_util.ram.slice(1, HISTORY_LAST));
  mem_util.swap.splice(0, HISTORY_LAST, ...mem_util.swap.slice(1, HISTORY_LAST));
  mem_util.ram[HISTORY_LAST] = Memory.RAM;
  mem_util.swap[HISTORY_LAST] = Memory.Swap;

  ram_unit = bisectLeft(Math.max(YAXIS_MIN, ...mem_util.ram), CONVERSION_FROM_B);
  update_memory_trace();

  let MemUtilGhostText = mem_util.ram[HISTORY_LAST] / CONVERSION_FROM_B[ram_unit];
  MemoryUtilGhost.innerText = `${clip10(MemUtilGhostText, 1)}${ram_unit}`;
}

function update_network_io_trace() {
  network_io_unit = bisectLeft(Math.max(
    YAXIS_MIN, ...network_io.tx, ...network_io.rx
  ), CONVERSION_FROM_B);

  NetworkIoTraces[0].y = network_io.tx.map(x => x === null ? null : x/CONVERSION_FROM_B[network_io_unit] / REFRESH_PERIOD);
  NetworkIoTraces[1].y = network_io.rx.map(x => x === null ? null : x/CONVERSION_FROM_B[network_io_unit] / REFRESH_PERIOD);

  NetworkIoTraces[0].name = `${NET_IO_TAGS[0]}: ${(network_io.tx[HISTORY_LAST]/CONVERSION_FROM_B[tx_io_unit]).toFixed(1)} ${tx_io_unit}ps`;
  NetworkIoTraces[1].name = `${NET_IO_TAGS[1]}: ${(network_io.rx[HISTORY_LAST]/CONVERSION_FROM_B[rx_io_unit]).toFixed(1)} ${rx_io_unit}ps`;

  layout_config.Network_io.y_axis_max = Math.max(
    ...NetworkIoTraces[0].y,
    ...NetworkIoTraces[1].y,
  ) * YAXIS_MAX_MULTIPLIER;
}
const NetGhost = document.getElementById("net-ghost");
function update_Network_io({Network_IO}) {
  network_io.tx.splice(0, HISTORY_LAST, ...network_io.tx.slice(1, HISTORY_LAST));
  network_io.rx.splice(0, HISTORY_LAST, ...network_io.rx.slice(1, HISTORY_LAST));
  network_io.tx[HISTORY_LAST] = parseFloat(Network_IO.tx);
  network_io.rx[HISTORY_LAST] = parseFloat(Network_IO.rx);

  tx_io_unit = bisectLeft(Math.max(
    YAXIS_MIN, ...network_io.tx
  ), CONVERSION_FROM_B);
  rx_io_unit = bisectLeft(Math.max(
    YAXIS_MIN, ...network_io.rx
  ), CONVERSION_FROM_B);
  update_network_io_trace();

  const txGhost = clip10(network_io.tx[HISTORY_LAST] / CONVERSION_FROM_B[tx_io_unit], 1);
  const rxGhost = clip10(network_io.rx[HISTORY_LAST] / CONVERSION_FROM_B[rx_io_unit], 1);
  const ghostTxt = network_io.rx[HISTORY_LAST] > network_io.tx[HISTORY_LAST] ? `↓ ${rxGhost}${rx_io_unit}` : `↑ ${txGhost}${tx_io_unit}`;
  NetGhost.innerText = `${ghostTxt}ps`;
}

function update_meross_trace() {
  MerossPowerTraces[0].y = meross_power.map(x => x === null ? null : x[meross_power_to_show] === undefined ? null : x[meross_power_to_show])
  MerossPowerTraces[0].name = `${meross_power_to_show}: ${clip10(meross_power[HISTORY_LAST][meross_power_to_show], 1)} W`;
  layout_config.Meross_power.y_axis_max = Math.max(
    ...meross_power.map(x => x === null ? 0 : x[meross_power_to_show] === undefined ? 0 : x[meross_power_to_show])
  ) * YAXIS_MAX_MULTIPLIER;
}
const MerossGhost = document.getElementById("meross-power-ghost")
function update_Meross_power({Meross_Power}) {
  let new_sensors;
  let missing_sensors;

  if (meross_power[HISTORY_LAST]) {
    new_sensors = Object.keys(Meross_Power).filter((sensor) => !Object.keys(meross_power[HISTORY_LAST]).includes(sensor));
    missing_sensors = Object.keys(meross_power[HISTORY_LAST]).filter((sensor) => !Object.keys(Meross_Power).includes(sensor));
  } else {
    new_sensors = Object.keys(Meross_Power);
    missing_sensors = [];
  }

  if (new_sensors.length) {
    Array.from(document.getElementById("meross-selector").children).map(o => o.remove());
    all_sensors.splice(0, all_sensors.length);

    for (let sensor of Object.keys(Meross_Power).sort()) {
      const sensor_option = document.createElement("option");
      sensor_option.value = sensor;
      sensor_option.innerText = sensor;
      document.getElementById("meross-selector").appendChild(sensor_option);

      all_sensors.splice(all_sensors.length, 0, sensor);
    }

    if (!Object.keys(Meross_Power).includes(meross_power_to_show)) {
      meross_power_to_show = Object.keys(Meross_Power).sort()[0];
    }
    document.getElementById("meross-selector").value = meross_power_to_show;
  }

  if (missing_sensors.length) {
    Array.from(document.getElementById("meross-selector").children).map(o => o.remove());
    all_sensors.splice(0, all_sensors.length)

    for (let sensor of Object.keys(Meross_Power).sort()) {
      const sensor_option = document.createElement("option");
      sensor_option.value = sensor;
      sensor_option.innerText = sensor;
      document.getElementById("meross-selector").appendChild(sensor_option);

      all_sensors.splice(all_sensors.length, 0, sensor);
    }

    if (missing_sensors.includes(meross_power_to_show)) {
      meross_power_to_show = Object.keys(Meross_Power).sort()[0];
      document.getElementById("meross-selector").value = meross_power_to_show;
    }
  }

  meross_power.splice(0, HISTORY_LAST, ...meross_power.slice(1, HISTORY_LAST));
  meross_power[HISTORY_LAST] = Meross_Power;

  update_meross_trace();

  const ghostTxt = clip10(Meross_Power[meross_power_to_show], 1);
  MerossGhost.innerText = `${ghostTxt}W`;
}


function do_blink() {
  status_count = !status_count;

  indicator_el.style.backgroundColor = heartbeat_colors[status_count%2];
  setTimeout(() => {
    status_count = !status_count;
    indicator_el.style.backgroundColor = heartbeat_colors[status_count%2];
  }, BLINK_PERIOD * 1000/2);

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

  time_units = ["y", "w", "d", "h", "m", "s"];
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

  REFRESH_PERIOD = status.Time;
  isDarkMode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (init_done == 1) {
    layout_config[trace].updator(status);
    layout.yaxis.range = [0, Math.max(1, layout_config[trace].y_axis_max)];
    layout.yaxis.title = formatStr(layout_config[trace].y_title, layout_config[trace].units());

    Plotly.redraw("Plot-Area");

    for (let resource of views) {
      if (resource !== trace) {
        layout_config[resource].updator(status);
      }
    }
  }
});

// ----------------------------------------------------

let view = 1;
const views = [
  /* 0 */ "CPU_util",
  /* 1 */ "Meross_power",
  /* 2 */ "Memory",
  /* 3 */ "Network_io",
  /* 4 */ "CPU_temp",
  /* 5 */ "Disk_io",
]

document.onkeydown = ((event) => {
  switch (event.key) {
    case "1":
      view = 1;
      ChangePlot(0, views[0]);
      break;

    case "2":
      view = 2;
      if (trace == views[1]) {
        meross_power_to_show = all_sensors[(all_sensors.indexOf(meross_power_to_show) + 1) % all_sensors.length];
        MerossPowerSelect(meross_power_to_show);
        document.getElementById("meross-selector").value = meross_power_to_show;
      }
      ChangePlot(0, views[1]);
      break;

    case "@":
      view = 2;
      if (trace == views[1]) {
        meross_power_to_show = all_sensors[(all_sensors.indexOf(meross_power_to_show) + all_sensors.length - 1) % all_sensors.length];
        MerossPowerSelect(meross_power_to_show);
        document.getElementById("meross-selector").value = meross_power_to_show;
      }
      ChangePlot(0, views[1]);
      break;

    case "3":
      view = 2;
      ChangePlot(0, views[2]);
      break;

    case "4":
      view = 3;
      ChangePlot(0, views[3]);
      break;

    case "5":
      view = 4;
      if (trace == views[4]) {
        sensor_to_show = Object.keys(temp_sensors)[(Object.keys(temp_sensors).indexOf(sensor_to_show) + 1) % Object.keys(temp_sensors).length];
        SelectSensor(sensor_to_show);
        document.getElementById("sensor-selector").value = sensor_to_show;
      }
      ChangePlot(0, views[4]);
      break;

    case "%":
      view = 4;
      if (trace == views[4]) {
        sensor_to_show = Object.keys(temp_sensors)[(Object.keys(temp_sensors).indexOf(sensor_to_show) - 1 + Object.keys(temp_sensors).length) % Object.keys(temp_sensors).length];
        SelectSensor(sensor_to_show);
        document.getElementById("sensor-selector").value = sensor_to_show;
      }
      ChangePlot(0, views[4]);
      break;

    case "6":
      view = 5;
      if (trace == views[5]) {
        disk_to_show = all_disks[(all_disks.indexOf(disk_to_show) + 1) % all_disks.length];
        DiskSelect(disk_to_show);
        document.getElementById("disk-selector").value = disk_to_show;
      }
      ChangePlot(0, views[5]);
      break;

    case "^":
      view = 5;
      if (trace == views[5]) {
        disk_to_show = all_disks[(all_disks.indexOf(disk_to_show) + all_disks.length - 1) % all_disks.length];
        DiskSelect(disk_to_show);
        document.getElementById("disk-selector").value = disk_to_show;
      }
      ChangePlot(0, views[5]);
      break;

    case "ArrowRight":
    case "`":
      view = (view % views.length) + 1;
      ChangePlot(0, views[view-1]);
      break;

    case "ArrowLeft":
    case "~":
      view = ((view - 1) % views.length);
      view = view ? view : views.length;
      ChangePlot(0, views[(view-1)]);
      break;

    case "ArrowUp":
      if (trace == "Disk_io") {
        disk_to_show = all_disks[(all_disks.indexOf(disk_to_show) + all_disks.length - 1) % all_disks.length];
        DiskSelect(disk_to_show);
        document.getElementById("disk-selector").value = disk_to_show;
        ChangePlot(0, "Disk_io");
      } else if (trace == "CPU_temp") {
        sensor_to_show = Object.keys(temp_sensors)[(Object.keys(temp_sensors).indexOf(sensor_to_show) - 1 + Object.keys(temp_sensors).length) % Object.keys(temp_sensors).length];
        SelectSensor(sensor_to_show);
        document.getElementById("sensor-selector").value = sensor_to_show;
        ChangePlot(0, "CPU_temp");
      } else if (trace == "Meross_power") {
        meross_power_to_show = all_sensors[(all_sensors.indexOf(meross_power_to_show) + all_sensors.length - 1) % all_sensors.length];
        MerossPowerSelect(meross_power_to_show);
        document.getElementById("meross-selector").value = meross_power_to_show;
        ChangePlot(0, "Meross_power");
      }
      break;

    case "ArrowDown":
      if (trace == "Disk_io") {
        disk_to_show = all_disks[(all_disks.indexOf(disk_to_show) + 1) % all_disks.length];
        DiskSelect(disk_to_show);
        document.getElementById("disk-selector").value = disk_to_show;
        ChangePlot(0, "Disk_io");
      } else if (trace == "CPU_temp") {
        sensor_to_show = Object.keys(temp_sensors)[(Object.keys(temp_sensors).indexOf(sensor_to_show) + 1) % Object.keys(temp_sensors).length];
        SelectSensor(sensor_to_show);
        document.getElementById("sensor-selector").value = sensor_to_show;
        ChangePlot(0, "CPU_temp");
      } else if (trace == "Meross_power") {
        meross_power_to_show = all_sensors[(all_sensors.indexOf(meross_power_to_show) + 1) % all_sensors.length];
        MerossPowerSelect(meross_power_to_show);
        document.getElementById("meross-selector").value = meross_power_to_show;
        ChangePlot(0, "Meross_power");
      }
      break;
  }
});
