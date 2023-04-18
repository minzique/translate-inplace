browser.contextMenus.create({
  id: "translate-auto",
  title: "Translate to English (Auto)",
  contexts: ["all"],
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId == "translate-auto") {
    // FIXME
    // this a stiched together script with everything hardcoded
    // calls translate('auto', 'en') when readyCallback is hit
    injectJSResource(tab, "/src/scripts/ext/auto-en.js");
  }
});

async function injectJSResource(tab, path) {
  return browser.tabs.sendMessage(tab.id, {
    inject: {
      code: await fetch(browser.runtime.getURL(path))
        .then((d) => d.text())
        .catch(() => {
          throw new Error("Couldn't fetch JS resource");
        }),
      name: path.split('/').pop()
    },
  });
}

function loadGoogleLib(tab) {

}
