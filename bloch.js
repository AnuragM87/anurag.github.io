/*
 * bloch.js — animated Bloch sphere for the hero of the stylish page.
 *
 * A qubit state precesses around a slowly turning sphere and leaves a
 * fading trail. It only draws while the canvas is visible, so it costs
 * nothing on the simple page.
 */
(() => {
  const canvas = document.getElementById("bloch");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const TILT = 0.38; // how far the camera looks down onto the sphere (radians)
  let W = 0, H = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Spin (x, y, z) about the vertical axis by `yaw`, tilt the camera down,
  // then project orthographically. depth > 0 means facing the viewer.
  function project([x, y, z], v) {
    const x1 = x * Math.cos(v.yaw) - y * Math.sin(v.yaw);
    const y1 = x * Math.sin(v.yaw) + y * Math.cos(v.yaw);
    return {
      x: v.cx + x1 * v.R,
      y: v.cy - (z * Math.cos(TILT) + y1 * Math.sin(TILT)) * v.R,
      depth: z * Math.sin(TILT) - y1 * Math.cos(TILT),
    };
  }

  // Closed curve on the sphere; the half behind the sphere is drawn faintly.
  function ring(pointAt, v, color, front, back) {
    const N = 96;
    const paths = [new Path2D(), new Path2D()]; // [behind, in front]
    let prev = project(pointAt(0), v);
    for (let i = 1; i <= N; i++) {
      const p = project(pointAt((i / N) * Math.PI * 2), v);
      const path = paths[p.depth + prev.depth > 0 ? 1 : 0];
      path.moveTo(prev.x, prev.y);
      path.lineTo(p.x, p.y);
      prev = p;
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = back;
    ctx.stroke(paths[0]);
    ctx.globalAlpha = front;
    ctx.stroke(paths[1]);
    ctx.globalAlpha = 1;
  }

  function line(a, b, v, color, dash = []) {
    const p = project(a, v), q = project(b, v);
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function label(text, at, v) {
    const p = project(at, v);
    ctx.globalAlpha = p.depth < -0.2 ? 0.45 : 0.9;
    ctx.fillText(text, p.x, p.y);
    ctx.globalAlpha = 1;
  }

  // The qubit's state on the sphere at time t (seconds).
  function state(t) {
    const theta = 1.05 + 0.55 * Math.sin(t * 0.5);
    const phi = t * 1.1;
    return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
  }

  function draw(t) {
    const v = { R: Math.min(W, H) * 0.36, cx: W / 2, cy: H / 2, yaw: t * 0.15 };
    ctx.clearRect(0, 0, W, H);

    // Sphere body with a soft highlight.
    const g = ctx.createRadialGradient(v.cx - v.R * 0.35, v.cy - v.R * 0.4, v.R * 0.1, v.cx, v.cy, v.R);
    g.addColorStop(0, "rgba(124, 92, 255, 0.22)");
    g.addColorStop(0.7, "rgba(124, 92, 255, 0.06)");
    g.addColorStop(1, "rgba(0, 200, 255, 0.10)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(v.cx, v.cy, v.R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(233, 231, 242, 0.35)";
    ctx.stroke();

    // Grid: equator, two latitudes, two meridians.
    ctx.lineWidth = 1;
    const r = Math.sqrt(0.75);
    ring((a) => [Math.cos(a), Math.sin(a), 0], v, "#9d8cff", 0.7, 0.18);
    ring((a) => [r * Math.cos(a), r * Math.sin(a), 0.5], v, "#e9e7f2", 0.18, 0.06);
    ring((a) => [r * Math.cos(a), r * Math.sin(a), -0.5], v, "#e9e7f2", 0.18, 0.06);
    ring((a) => [Math.cos(a), 0, Math.sin(a)], v, "#e9e7f2", 0.25, 0.07);
    ring((a) => [0, Math.cos(a), Math.sin(a)], v, "#e9e7f2", 0.25, 0.07);

    // Axes and basis-state labels.
    const axis = "rgba(233, 231, 242, 0.3)";
    line([-1.15, 0, 0], [1.15, 0, 0], v, axis, [3, 4]);
    line([0, -1.15, 0], [0, 1.15, 0], v, axis, [3, 4]);
    line([0, 0, -1.15], [0, 0, 1.15], v, axis, [3, 4]);
    ctx.font = '500 13px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#e9e7f2";
    label("|0⟩", [0, 0, 1.3], v);
    label("|1⟩", [0, 0, -1.3], v);
    label("|+⟩", [1.32, 0, 0], v);
    label("|+i⟩", [0, 1.32, 0], v);

    // Fading trail of where the state has been.
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    const STEPS = 80;
    let prev = project(state(t - STEPS * 0.03), v);
    for (let k = STEPS - 1; k >= 0; k--) {
      const p = project(state(t - k * 0.03), v);
      ctx.strokeStyle = `rgba(0, 200, 255, ${(1 - k / STEPS) * (p.depth < 0 ? 0.35 : 0.8)})`;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      prev = p;
    }

    // State vector, its shadow on the equator plane, and a glowing tip.
    const s = state(t);
    line(s, [s[0], s[1], 0], v, "rgba(255, 92, 168, 0.5)", [2, 4]);
    line([0, 0, 0], [s[0], s[1], 0], v, "rgba(255, 92, 168, 0.35)", [2, 4]);

    const o = project([0, 0, 0], v), tip = project(s, v);
    const grad = ctx.createLinearGradient(o.x, o.y, tip.x, tip.y);
    grad.addColorStop(0, "#7c5cff");
    grad.addColorStop(1, "#00c8ff");
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    ctx.fillStyle = "#e9e7f2";
    ctx.beginPath();
    ctx.arc(o.x, o.y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = "#00c8ff";
    ctx.shadowBlur = 22;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  const start = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!canvas.offsetParent || document.hidden) return; // page hidden: skip
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
    draw(reducedMotion.matches ? 4 : (now - start) / 1000);
  }
  requestAnimationFrame(frame);
})();
