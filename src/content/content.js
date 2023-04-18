
function injectScript(code){
  const script = document.createElement("script");
  script.textContent = code;
  document.head.appendChild(script);
}

browser.runtime.onMessage.addListener(function (message, sender, callback) {
  if (message.inject) {
    injectScript(message.inject.code)
  }
});
