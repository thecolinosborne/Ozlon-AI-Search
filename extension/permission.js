const q = new URLSearchParams(location.search);
const kind = q.get("kind");
const $ = (id) => document.getElementById(id);
if (kind === "start") {
  $("title").textContent = "Ozlon wants to use this browser";
  $("sub").textContent = "It will open a new tab and work there. You can watch it.";
  $("detail").textContent = q.get("goal");
  $("site").style.display = "none";
  $("all").textContent = "Always allow new jobs";
} else {
  $("title").textContent = "Ozlon is about to press a button";
  $("sub").textContent = "On " + q.get("host");
  $("detail").textContent = '"' + q.get("label") + '"' + (q.get("typed") ? ' with text: "' + q.get("typed") + '"' : "");
}
document.querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "perm", id: q.get("id"), answer: b.dataset.a });
  window.close();
}));
