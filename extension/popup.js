const $ = (id) => document.getElementById(id);
async function render() {
  const { token, status } = await chrome.storage.local.get(["token", "status"]);
  $("paired").hidden = !token; $("unpaired").hidden = !!token;
  $("status").textContent = status ? "Last: " + status : "";
}
$("pair").onclick = async () => {
  $("err").textContent = "";
  const d = await chrome.runtime.sendMessage({ type: "pair", code: $("code").value.trim() });
  if (!d || !d.success) $("err").textContent = (d && d.error) || "Could not connect.";
  render();
};
$("unpair").onclick = async () => { await chrome.runtime.sendMessage({ type: "unpair" }); render(); };
$("reset").onclick = async () => { await chrome.storage.local.remove("perms"); $("reset").textContent = "Permissions reset"; };
render();
