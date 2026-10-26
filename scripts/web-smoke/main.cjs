const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { version } = require("../../package.json");

const url = process.env.WEB_SMOKE_URL;
const resultPath = process.env.WEB_SMOKE_RESULT;
const profile = process.env.WEB_SMOKE_PROFILE;
const checks = [];
const consoleErrors = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function finish() {
  const ok = checks.length > 0 && checks.every((check) => check.ok) && consoleErrors.length === 0;
  writeFileSync(
    resultPath,
    JSON.stringify({ ok, checks, consoleErrors }, null, 2)
  );
  app.exit(ok ? 0 : 1);
}

app.setPath("userData", profile);
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 393,
    height: 852,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  window.webContents.on("console-message", (event) => {
    const level = event?.level ?? "info";
    if (level === "error") consoleErrors.push(event.message ?? "unknown page error");
  });

  try {
    await window.loadURL(url);
    await sleep(1200);

    const welcome = await window.webContents.executeJavaScript(
      "Boolean(document.querySelector('[data-testid=\"web-welcome\"]'))"
    );
    record("the web welcome offers a storage choice", welcome, welcome ? "welcome rendered" : "welcome missing");
    if (!welcome) return finish();

    await window.webContents.executeJavaScript(
      "document.querySelector('[data-testid=\"use-browser-storage\"]')?.click()"
    );
    let library = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      library = await window.webContents.executeJavaScript(
        "Boolean(document.querySelector('[data-testid=\"library-view\"]'))"
      );
      if (library) break;
      await sleep(250);
    }
    record("browser storage opens the library", library, library ? "library view rendered" : "library view missing");
    if (!library) return finish();

    const result = await window.webContents.executeJavaScript(`(async () => {
      const out = {
        book: null,
        chapter: null,
        saved: null,
        reopened: null,
        root: null,
        buildTarget: null,
        buildVersion: null,
        buildAgent: null,
        staleStatus: null,
        conflictCount: null,
        archiveEntries: null,
        archiveName: null,
        archiveBytes: null,
        archiveMagic: null,
        error: null
      };
      try {
        const created = await window.studio.books.create({
          title: "Web Smoke Book",
          description: "Created by the browser smoke run."
        });
        if (!created.ok) throw new Error(created.error.message);
        out.book = created.data.id;

        const chapter = await window.studio.chapters.create(created.data.id, { title: "One" });
        if (!chapter.ok) throw new Error(chapter.error.message);
        out.chapter = chapter.data.id;

        const saved = await window.studio.chapters.save({
          bookId: created.data.id,
          chapterId: chapter.data.id,
          content: "Browser smoke prose.\\n",
          baseVersion: chapter.data.version,
          baseHash: chapter.data.hash
        });
        if (!saved.ok || saved.data.status !== "saved") throw new Error("save did not commit");
        out.saved = saved.data.chapter.version;

        const reopened = await window.studio.books.open(created.data.id);
        if (!reopened.ok) throw new Error(reopened.error.message);
        out.reopened = reopened.data.chapters[0]?.content ?? null;

        const root = await window.studio.library.current();
        out.root = root.ok ? root.data.root : null;
        out.storageTier = root.ok ? (root.data.storage?.tier ?? null) : null;
        out.lastCommittedAt = root.ok ? (root.data.storage?.lastCommittedAt ?? null) : null;

        /*
         * The minimal mode in a browser: the ambient status is a pure function over the book, so
         * this build computes it itself even though the writing agent needs the desktop.
         */
        const ambient = await window.studio.agent.ambient(created.data.id);
        out.ambientOk = ambient.ok;
        out.ambientSay = ambient.ok ? ambient.data.say : null;
        out.ambientActions = ambient.ok ? ambient.data.actions.length : -1;

        const build = await window.studio.app.info();
        out.buildTarget = build.ok ? build.data.target : null;
        out.buildVersion = build.ok ? build.data.version : null;
        out.buildAgent = build.ok ? (build.data.capabilities.find((entry) => entry.id === "agent")?.available ?? null) : null;

        const stale = await window.studio.chapters.save({
          bookId: created.data.id,
          chapterId: chapter.data.id,
          content: "Stale browser smoke prose.\\n",
          baseVersion: chapter.data.version,
          baseHash: chapter.data.hash
        });
        out.staleStatus = stale.ok ? stale.data.status : null;
        const conflicts = await window.studio.conflicts.list(created.data.id);
        out.conflictCount = conflicts.ok ? conflicts.data.length : -1;

        const chunks = [];
        Object.defineProperty(window, "showSaveFilePicker", {
          configurable: true,
          value: async () => ({
            name: "smoke-archive.zip",
            async createWritable() {
              return {
                async write(chunk) {
                  chunks.push(chunk);
                },
                async close() {},
                async abort() {}
              };
            }
          })
        });
        const archive = await window.studio.library.exportArchive();
        out.archiveEntries = archive.ok ? archive.data.entryCount : -1;
        out.archiveName = archive.ok ? archive.data.path : null;
        out.archiveBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        out.archiveMagic =
          chunks[0] instanceof Uint8Array && chunks[0][0] === 0x50 && chunks[0][1] === 0x4b;
      } catch (error) {
        out.error = error.message;
      }
      return out;
    })()`);

    record("a book and chapter can be created", Boolean(result.book && result.chapter), result.error ?? result.book ?? "failed");
    record("a save commits a new version", result.saved === 2, `version ${result.saved}`);
    record("the saved prose reopens", result.reopened === "Browser smoke prose.\n", JSON.stringify(result.reopened));
    record("the library identifies itself as browser storage", String(result.root ?? "").startsWith("browser://"), result.root ?? "no root");
    record(
      "the library reports browser storage durability",
      result.storageTier === "browser" && Boolean(result.lastCommittedAt),
      `${result.storageTier ?? "no tier"} · ${result.lastCommittedAt ?? "no confirmed save"}`
    );
    record(
      "the minimal mode knows where the author is, in a browser",
      result.ambientOk === true &&
        typeof result.ambientSay === "string" &&
        /Smoke/i.test(result.ambientSay) &&
        result.ambientSay.length > 20,
      String(result.ambientSay ?? "no status").slice(0, 74)
    );
    record(
      "the minimal mode offers the studio's verbs in a browser",
      result.ambientActions >= 4,
      `${result.ambientActions ?? "no"} actions`
    );

    record(
      "the web build reports its own metadata",
      result.buildTarget === "web" && result.buildVersion === version && result.buildAgent === false,
      `${result.buildTarget ?? "no target"} ${result.buildVersion ?? "no version"}`
    );
    record(
      "a stale browser save keeps a conflict copy",
      result.staleStatus === "conflict" && result.conflictCount >= 1,
      `${result.staleStatus ?? "no status"} · ${result.conflictCount ?? "no count"} conflict(s)`
    );
    record(
      "the library exports a portable archive",
      result.archiveEntries > 0 && result.archiveMagic === true && result.archiveBytes > 0,
      `${result.archiveEntries ?? "no"} entries · ${result.archiveName ?? "no file"}`
    );

    try {
      const debug = window.webContents.debugger;
      debug.attach("1.3");
      try {
        await debug.sendCommand("Emulation.setEmulatedMedia", {
          features: [
            { name: "prefers-reduced-motion", value: "reduce" },
            { name: "prefers-reduced-transparency", value: "reduce" }
          ]
        });
        const styles = await window.webContents.executeJavaScript(`(() => {
          const root = getComputedStyle(document.documentElement);
          const glass = document.querySelector(".glass, .glass-strong, .glass-dialog");
          return {
            duration: root.getPropertyValue("--duration-fast").trim(),
            backdrop: glass ? getComputedStyle(glass).backdropFilter : "no-glass"
          };
        })()`);
        record(
          "reduced motion and transparency are honored",
          (styles.duration === "0s" || styles.duration === "0ms") &&
            (styles.backdrop === "none" || styles.backdrop === "no-glass"),
          JSON.stringify(styles)
        );
      } finally {
        debug.detach();
      }
    } catch (error) {
      record("reduced motion and transparency are honored", false, error.message);
    }
  } catch (error) {
    record("the web shell loaded", false, error.message);
  } finally {
    finish();
  }
});
