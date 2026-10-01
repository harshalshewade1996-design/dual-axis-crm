const authorized=new URLSearchParams(location.search).get('result')==='authorized';
document.getElementById('resultTitle').textContent=authorized?'Instagram authorized':'Authorization not completed';
document.getElementById('resultDescription').textContent=authorized?'Your account is ready for review. Dual Axis Media will confirm the Instagram account and client before connecting it to CRM.':'Ask Dual Axis Media for a new connection link and try again.';
