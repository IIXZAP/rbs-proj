// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8080;



app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Server is running");
});
app.get("/facilitator", (_, res) => res.sendFile(__dirname + "/public/facilitator.html"));
app.get("/team", (_, res) => res.sendFile(__dirname + "/public/team.html"));
app.get("/audience", (_, res) => res.sendFile(__dirname + "/public/audience.html"));

/**
 * GAME STATE (MVP)
 * - 12 teams
 * - round has 4 active teams
 * - phases: A (Customer/Pain), B (WeHelp), C (Event Pivot), D (Blue Ocean Move), END
 */
const state = {
  gameCode: "RSU150",
  currentRound: 1,
  activeTeams: [1, 2, 3, 4],
  phase: "A",
  eventText: "",
  teams: Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    name: `Team ${i + 1}`,
    value: 0,
    competition: 0,
    diff: 0,
    customer: "",
    pain: "",
    wehelp: { who: "", problem: "", by: "" },
    pivot: "",
    blueMove: "",
    lastUpdateAt: null,
  })),
  audienceVotes: {
    valueTeam: null,
    diffTeam: null,
    redOceanTeam: null,
  },
};

const CUSTOMER_CARDS = [
  "นักศึกษาที่งบน้อย",
  "คนทำงานรีบตอนเช้า",
  "ผู้ประกอบการรายย่อย",
  "คนรักสุขภาพแต่ไม่มีเวลา",
  "คนเมืองที่ไม่ชอบรอคิว",
  "นักท่องเที่ยวมือใหม่",
];

const PAIN_CARDS = [
  "เสียเวลา/ต้องรอนาน",
  "ราคาแพงเกินคุ้ม",
  "หาข้อมูลยาก/ตัดสินใจยาก",
  "คุณภาพไม่สม่ำเสมอ",
  "ขั้นตอนยุ่งยาก",
  "ไม่มั่นใจ/กลัวพลาด",
];

const EVENT_CARDS = [
  "คู่แข่งตัดราคา 30%",
  "งบการตลาดหายไปครึ่ง",
  "รีวิว 1 ดาวไวรัลในโซเชียล",
  "เทรนด์ใหม่มาแรงใน TikTok",
  "แพลตฟอร์มเปลี่ยนนโยบายโฆษณา",
];

function setActiveTeamsByRound(round) {
  const start = (round - 1) * 4 + 1;
  state.activeTeams = [start, start + 1, start + 2, start + 3];
}

function getPublicState() {
  const active = new Set(state.activeTeams);
  return {
    gameCode: state.gameCode,
    currentRound: state.currentRound,
    activeTeams: state.activeTeams,
    phase: state.phase,
    eventText: state.eventText,
    teams: state.teams.map((t) => ({
      id: t.id,
      name: t.name,
      value: t.value,
      competition: t.competition,
      diff: t.diff,
      customer: active.has(t.id) ? t.customer : "",
      pain: active.has(t.id) ? t.pain : "",
      wehelp: active.has(t.id) ? t.wehelp : { who: "", problem: "", by: "" },
      pivot: active.has(t.id) ? t.pivot : "",
      blueMove: active.has(t.id) ? t.blueMove : "",
    })),
  };
}

function applyBlueMove(team, move) {
  // Simple scoring rules (MVP):
  // Eliminate/Reduce => competition -1, value +1
  // Raise/Create => diff +1, value +1
  if (!team) return;
  const m = (move || "").toLowerCase();
  if (m.includes("eliminate") || m.includes("reduce")) {
    team.competition = Math.max(0, team.competition - 1);
    team.value += 1;
  } else if (m.includes("raise") || m.includes("create")) {
    team.diff += 1;
    team.value += 1;
  } else {
    // fallback
    team.value += 1;
  }
}

io.on("connection", (socket) => {
  socket.emit("state", getPublicState());

  socket.on("joinTeam", ({ teamId, teamName }) => {
    const t = state.teams.find((x) => x.id === Number(teamId));
    if (!t) return;
    if (teamName && teamName.trim()) t.name = teamName.trim().slice(0, 24);
    socket.data.teamId = t.id;
    socket.emit("joined", { teamId: t.id, name: t.name });
    io.emit("state", getPublicState());
  });

  socket.on("joinAudience", () => {
    socket.data.audience = true;
    socket.emit("joinedAudience", true);
    socket.emit("state", getPublicState());
  });

  // TEAM submits
  socket.on("submitPhaseA", ({ customer, pain }) => {
    const teamId = socket.data.teamId;
    const t = state.teams.find((x) => x.id === Number(teamId));
    if (!t) return;
    if (!state.activeTeams.includes(t.id)) return;
    t.customer = (customer || "").slice(0, 80);
    t.pain = (pain || "").slice(0, 120);
    t.lastUpdateAt = Date.now();
    io.emit("state", getPublicState());
  });

  socket.on("submitPhaseB", ({ who, problem, by }) => {
    const teamId = socket.data.teamId;
    const t = state.teams.find((x) => x.id === Number(teamId));
    if (!t) return;
    if (!state.activeTeams.includes(t.id)) return;

    t.wehelp = {
      who: (who || "").slice(0, 60),
      problem: (problem || "").slice(0, 80),
      by: (by || "").slice(0, 80),
    };

    // Basic scoring: complete fields => +1 value
    if (t.wehelp.who && t.wehelp.problem && t.wehelp.by) t.value += 1;
    // If looks generic, facilitator can adjust later.

    t.lastUpdateAt = Date.now();
    io.emit("state", getPublicState());
  });

  socket.on("submitPhaseC", ({ pivot }) => {
    const teamId = socket.data.teamId;
    const t = state.teams.find((x) => x.id === Number(teamId));
    if (!t) return;
    if (!state.activeTeams.includes(t.id)) return;
    t.pivot = (pivot || "").slice(0, 140);
    t.lastUpdateAt = Date.now();
    io.emit("state", getPublicState());
  });

  socket.on("submitPhaseD", ({ blueMove }) => {
    const teamId = socket.data.teamId;
    const t = state.teams.find((x) => x.id === Number(teamId));
    if (!t) return;
    if (!state.activeTeams.includes(t.id)) return;

    t.blueMove = (blueMove || "").slice(0, 60);
    applyBlueMove(t, t.blueMove);

    t.lastUpdateAt = Date.now();
    io.emit("state", getPublicState());
  });

  // Audience voting (simple)
  socket.on("vote", ({ valueTeam, diffTeam, redOceanTeam }) => {
    // store last vote snapshot
    state.audienceVotes = { valueTeam, diffTeam, redOceanTeam };
    // optional: apply immediately as points
    const vt = state.teams.find((x) => x.id === Number(valueTeam));
    const dt = state.teams.find((x) => x.id === Number(diffTeam));
    const rt = state.teams.find((x) => x.id === Number(redOceanTeam));
    if (vt) vt.value += 1;
    if (dt) dt.diff += 1;
    if (rt) rt.competition += 1;
    io.emit("state", getPublicState());
  });

  // Facilitator controls
  socket.on("facilitator:setPhase", ({ phase }) => {
    state.phase = phase;
    io.emit("state", getPublicState());
  });

  socket.on("facilitator:nextRound", () => {
    state.currentRound = Math.min(3, state.currentRound + 1);
    setActiveTeamsByRound(state.currentRound);
    state.phase = "A";
    state.eventText = "";
    io.emit("state", getPublicState());
  });

  socket.on("facilitator:drawRandom", ({ type }) => {
    if (type === "customer") {
      // set random customer/pain for active teams if empty
      for (const id of state.activeTeams) {
        const t = state.teams.find((x) => x.id === id);
        if (t && !t.customer) t.customer = CUSTOMER_CARDS[Math.floor(Math.random() * CUSTOMER_CARDS.length)];
        if (t && !t.pain) t.pain = PAIN_CARDS[Math.floor(Math.random() * PAIN_CARDS.length)];
      }
    }
    if (type === "event") {
      state.eventText = EVENT_CARDS[Math.floor(Math.random() * EVENT_CARDS.length)];
    }
    io.emit("state", getPublicState());
  });

  socket.on("facilitator:adjustScore", ({ teamId, deltaValue, deltaComp, deltaDiff }) => {
    const t = state.teams.find((x) => x.id === Number(teamId));
    if (!t) return;
    t.value += Number(deltaValue || 0);
    t.competition = Math.max(0, t.competition + Number(deltaComp || 0));
    t.diff += Number(deltaDiff || 0);
    io.emit("state", getPublicState());
  });
});

// server.listen(3000, () => console.log("Game running on http://localhost:3000/facilitator"));
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Game running on port ${PORT}`);
});

