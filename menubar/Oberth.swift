// Oberth's menu bar app: a client of the Oberth service on 127.0.0.1 (port from config.json, 7777 by default).
// It has no settings of its own: the browser, the editor, the assistant and the modules come from GET /api/config.
import AppKit
import UserNotifications

struct ForeignView: Decodable { let pid: Int; let port: Int }
struct ScriptView: Decodable { let status: String; let startedAt: Double; let endedAt: Double? }
struct SessionView: Decodable { let title: String; let working: Bool }
struct AboutView: Decodable { let description: String? }
struct HolderView: Decodable { let kind: String; let name: String?; let pid: Int; let command: String? }
struct ConflictView: Decodable { let port: Int; let holder: HolderView }
/// What would make a launch fail (the service's preflight.ts): short for the row, text for the tooltip.
struct PreflightView: Decodable { let check: String; let short: String; let text: String }
struct ProjectView: Decodable {
  let id: String; let name: String; let kind: String; let status: String; let mode: String
  let url: String?; let port: Int?; let hidden: Bool; let repoUrl: String?; let foreign: [ForeignView]; let foreignUrl: String?
  let error: String?; let phone: Bool?; let errors: Int?; let checks: [String]?; let scripts: [String: ScriptView]?; let assistant: SessionView?; let conflict: ConflictView?; let about: AboutView?
  let preflight: [PreflightView]?
  /// the stable address (http://<name>.localhost:7700/) while Oberth's proxy is up
  let address: String?
  /// open the dev server's own address anyway (a login redirect is pinned to that port)
  let openPort: Bool?
  /// where Open goes: the stable address unless the project opens on its own port
  func page(_ url: String) -> String { openPort == true ? url : address ?? url }
  var active: Bool { ["installing", "starting", "running", "stopping"].contains(status) }
  var path: String { "api/projects/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)" }
  /// What an assistant item does here: reopen the project's session, or start a new one.
  func assistantAction(_ label: String) -> String {
    guard let c = assistant else { return "New \(label) session" }
    return "Open “\(c.title.count > 32 ? String(c.title.prefix(31)) + "…" : c.title)”"
  }
}

/// One Agenda item, as much of it as the menu needs. The menu only ever sends back its key.
struct AgendaItemView: Decodable {
  let key: String; let projectId: String?; let `where`: String; let title: String; let detail: String?; let source: String; let fingerprint: String
  /// The project's name in front, except for the backup, whose title already says what it is about.
  var label: String { source == "backup" ? title : "\(`where`) · \(title)" }
}
struct AgendaView: Decodable { let needs: [AgendaItemView]; let count: Int }

/// The setup, from GET /api/config (the service reads config.json). Absent fields mean the defaults.
struct AssistantCan: Decodable { let open: Bool; let openNew: Bool }
struct AssistantSetup: Decodable { let id: String; let label: String; let bundleId: String?; let can: AssistantCan }
struct EditorSetup: Decodable { let id: String; let label: String }
struct SetupView: Decodable {
  let assistant: AssistantSetup?; let editor: EditorSetup?; let browser: String?; let modules: [String: Bool]?
  func on(_ m: String) -> Bool { modules?[m] ?? true }
}
var setup = SetupView(assistant: nil, editor: nil, browser: nil, modules: nil)

let stateDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/oberth")
let tokenFile = stateDir.appendingPathComponent("token")
/// The service's port: config.json's "port", else 7777, by the same rules as the service (service/config.ts):
/// 1024 to 65535 and not the proxy's port. Read once at launch, like the service reads it.
let port: Int = {
  guard let d = try? Data(contentsOf: stateDir.appendingPathComponent("config.json")),
        let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let p = o["port"] as? Int,
        (1024...65535).contains(p) else { return 7777 }
  let proxy = (o["proxyPort"] as? Int).flatMap { (1024...65535).contains($0) ? $0 : nil } ?? 7700
  return p == proxy ? 7777 : p
}()

/// Does what an Agenda item's button does (the service acts on it). Items the dashboard shows in a tab open the
/// dashboard there; when the item has cleared since, the dashboard shows what is left.
func openAgendaItem(_ key: String, projectId: String?) {
  request("api/agenda/open", method: "POST", body: ["key": key], timeout: 10) { data in
    guard let data = data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { openInBrowser(dashboardUrl(projectId)); return }
    let action = o["action"] as? [String: Any]
    if action?["kind"] as? String == "tab" {
      openInBrowser(projectId == nil ? dashboardUrl() : dashboardUrl(projectId, "&tab=\(action?["tab"] as? String ?? "about")"))
    }
  }
}
let base = URL(string: "http://127.0.0.1:\(port)")!

/// Async HTTP helper (localhost only). The completion runs on the main thread; data is nil on failure.
func request(_ path: String, method: String = "GET", body: [String: String]? = nil, timeout: TimeInterval = 3,
             _ done: @escaping (Data?) -> Void = { _ in }) {
  var req = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: timeout)
  req.httpMethod = method
  let token = (try? String(contentsOf: tokenFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  req.setValue(token, forHTTPHeaderField: "X-Oberth-Token")   // /api/agenda needs it on a GET too
  if method == "POST" {
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: body ?? [:])
  }
  URLSession.shared.dataTask(with: req) { data, resp, _ in
    let ok = (resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
    DispatchQueue.main.async { done(ok ? data : nil) }
  }.resume()
}

func post(_ path: String, _ body: [String: String]? = nil) { request(path, method: "POST", body: body, timeout: 10) }

/// The dashboard, optionally opened on one project's drawer (see the ?p= handling in dashboard/app.js).
func dashboardUrl(_ id: String? = nil, _ extra: String = "") -> String {
  guard let id = id, let enc = id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return "\(base)/" }
  return "\(base)/?p=\(enc)\(extra)"
}

/// The browser pages open in: config.json's "browser" (an app name), or the system's default for "default".
var browserName: String { setup.browser ?? "Safari" }
func openInBrowser(_ url: String) {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  p.arguments = browserName == "default" ? [url] : ["-a", browserName, url]
  try? p.run()
}
/// The browser's bundle id, to tell whether it is in front.
func browserBundleId() -> String? {
  if browserName == "default" {
    return NSWorkspace.shared.urlForApplication(toOpen: URL(string: "https://example.com")!).flatMap { Bundle(url: $0)?.bundleIdentifier }
  }
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  for dir in ["/Applications", "/System/Applications", "\(home)/Applications", "/System/Volumes/Preboot/Cryptexes/App/System/Applications"] {
    if let id = Bundle(path: "\(dir)/\(browserName).app")?.bundleIdentifier { return id }
  }
  return nil
}

/// Claude logo (Simple Icons "claude", CC0 SVG; the logo is Anthropic's trademark), for the ⌥ "Claude in …" rows when the assistant is Claude.
let claudeLogo: NSImage? = {
  let svg = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D97757" d="m4.714 15.956l4.718-2.648l.079-.23l-.08-.128h-.23l-.79-.048l-2.695-.073l-2.337-.097l-2.265-.122l-.57-.121l-.535-.704l.055-.353l.48-.321l.685.06l1.518.104l2.277.157l1.651.098l2.447.255h.389l.054-.158l-.133-.097l-.103-.098l-2.356-1.596l-2.55-1.688l-1.336-.972l-.722-.491L2 6.223l-.158-1.008l.656-.722l.88.06l.224.061l.893.686l1.906 1.476l2.49 1.833l.364.304l.146-.104l.018-.072l-.164-.274l-1.354-2.446l-1.445-2.49l-.644-1.032l-.17-.619a3 3 0 0 1-.103-.729L6.287.133L6.7 0l.995.134l.42.364l.619 1.415L9.735 4.14l1.555 3.03l.455.898l.243.832l.09.255h.159V9.01l.127-1.706l.237-2.095l.23-2.695l.08-.76l.376-.91l.747-.492l.583.28l.48.685l-.067.444l-.286 1.851l-.558 2.903l-.365 1.942h.213l.243-.242l.983-1.306l1.652-2.064l.728-.82l.85-.904l.547-.431h1.032l.759 1.129l-.34 1.166l-1.063 1.347l-.88 1.142l-1.263 1.7l-.79 1.36l.074.11l.188-.02l2.853-.606l1.542-.28l1.84-.315l.832.388l.09.395l-.327.807l-1.967.486l-2.307.462l-3.436.813l-.043.03l.049.061l1.548.146l.662.036h1.62l3.018.225l.79.522l.473.638l-.08.485l-1.213.62l-1.64-.389l-3.825-.91l-1.31-.329h-.183v.11l1.093 1.068l2.003 1.81l2.508 2.33l.127.578l-.321.455l-.34-.049l-2.204-1.657l-.85-.747l-1.925-1.62h-.127v.17l.443.649l2.343 3.521l.122 1.08l-.17.353l-.607.213l-.668-.122l-1.372-1.924l-1.415-2.168l-1.141-1.943l-.14.08l-.674 7.254l-.316.37l-.728.28l-.607-.461l-.322-.747l.322-1.476l.388-1.924l.316-1.53l.285-1.9l.17-.632l-.012-.042l-.14.018l-1.432 1.967l-2.18 2.945l-1.724 1.845l-.413.164l-.716-.37l.066-.662l.401-.589l2.386-3.036l1.439-1.882l.929-1.086l-.006-.158h-.055L4.138 18.56l-1.13.146l-.485-.456l.06-.746l.231-.243l1.907-1.312Z"/></svg>
"""
  let img = NSImage(data: Data(svg.utf8))
  img?.size = NSSize(width: 18, height: 18)
  return img
}()

/// The menu bar mark, from dashboard/logo.svg. Always a template image, so macOS tints it for the menu bar behind it.
/// A template can't hold colour, so when the dot is lit the mark comes without its dot and LampView draws one in that spot.
let markSize: CGFloat = 18
let markDot = (x: 20.67, y: 20.67, r: 3.4)   // in the logo's 32-unit viewBox
func markImage(dot: Bool) -> NSImage? {
  let svg = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill-rule="evenodd" d="M2 16a14 14 0 1 0 28 0a14 14 0 1 0 -28 0zM9.52 18.12a8.6 8.6 0 1 0 17.2 0a8.6 8.6 0 1 0 -17.2 0z"/>\(dot ? "<circle cx=\"\(markDot.x)\" cy=\"\(markDot.y)\" r=\"\(markDot.r)\"/>" : "")</svg>
"""
  let img = NSImage(data: Data(svg.utf8))
  img?.size = NSSize(width: markSize, height: markSize)
  img?.isTemplate = true
  return img
}
let markPlain = markImage(dot: true)
let markRing = markImage(dot: false)
let lampGreen = NSColor(srgbRed: 0x2f / 255, green: 0xb3 / 255, blue: 0x44 / 255, alpha: 1)   // the logo's green
let lampOrange = NSColor.systemOrange

/// The lit dot, laid over the status button. Finds the mark through the button's cell on each draw, so it follows the title's width.
final class LampView: NSView {
  var color: NSColor? { didSet { if color != oldValue { needsDisplay = true } } }
  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }   // clicks belong to the button
  override func draw(_ dirtyRect: NSRect) {
    guard let color = color, let button = superview as? NSButton, let cell = button.cell else { return }
    let mark = convert(cell.imageRect(forBounds: button.bounds), from: button)
    let unit = mark.width / 32
    color.setFill()
    NSBezierPath(ovalIn: NSRect(x: mark.minX + (markDot.x - markDot.r) * unit, y: mark.minY + (markDot.y - markDot.r) * unit,
                                width: markDot.r * 2 * unit, height: markDot.r * 2 * unit)).fill()
  }
}

final class Action: NSObject {
  let run: () -> Void
  init(_ run: @escaping () -> Void) { self.run = run }
  @objc func fire(_ sender: Any?) { run() }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, UNUserNotificationCenterDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  let lamp = LampView()
  let menu = NSMenu()
  var actions: [Action] = []   // keeps targets alive while the menu exists
  // Last data from the service. The menu is drawn from this instantly and never waits on the network.
  var projects: [ProjectView]?
  // Raw bytes behind what is shown, so an open menu is only rebuilt when something actually changed
  // (rebuilding an open NSMenu makes macOS re-layout it, which visibly resizes it).
  var projectsData: Data?
  var agenda: AgendaView?
  var agendaData: Data?
  var iconData: [String: Data] = [:]
  var drawnSignature: Int?
  var icons: [String: NSImage] = [:]
  var serviceDown = false
  var menuOpen = false
  var refreshing = false
  // Last seen status and script results, to notice crashes and finished scripts between polls.
  var seenStatus: [String: String] = [:]
  var seenScripts: [String: String] = [:]
  // Agenda items already seen, as key + fingerprint, so a session that blocks again on a new turn counts as new.
  // nil until the first answer: what is already waiting at startup doesn't notify.
  var seenAgenda: Set<String>?

  func applicationDidFinishLaunching(_ n: Notification) {
    menu.delegate = self
    menu.autoenablesItems = false
    item.menu = menu
    if let button = item.button {
      button.imagePosition = .imageLeft
      lamp.frame = button.bounds
      lamp.autoresizingMask = [.width, .height]
      button.addSubview(lamp)
    }
    UNUserNotificationCenter.current().delegate = self
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { ok, err in
      if !ok { NSLog("Oberth: notifications not allowed: \(err?.localizedDescription ?? "denied")") }
    }
    setTitle(nil)
    Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh(withIcons: false) }
    refresh(withIcons: true)
  }

  /// The mark, then the number of running projects. How many need the owner is in the tooltip and the menu.
  /// The mark's own dot shows the state: orange when something needs the owner, else green when something runs, else plain.
  func setTitle(_ list: [ProjectView]?) {
    let running = list?.filter { !$0.hidden && $0.active }.count ?? 0
    let needs = list == nil ? 0 : agenda?.count ?? 0
    lamp.color = needs > 0 ? lampOrange : running > 0 ? lampGreen : nil
    item.button?.image = lamp.color == nil ? markPlain : markRing
    item.button?.title = running > 0 ? "\(running)" : ""
    let tips = [running > 0 ? "\(running) running" : nil, needs > 0 ? "\(needs) need\(needs == 1 ? "s" : "") you" : nil].compactMap { $0 }
    item.button?.toolTip = list == nil ? "Oberth service not running" : tips.isEmpty ? "Oberth" : tips.joined(separator: " · ")
  }

  // MARK: notifications

  /// agendaKey: clicking does what the item's own button does, instead of opening url.
  func notify(_ title: String, _ body: String, open url: String, agendaKey: String? = nil, projectId: String? = nil) {
    let c = UNMutableNotificationContent()
    c.title = title; c.body = body; c.sound = .default
    var userInfo: [String: String] = ["url": url]
    if let key = agendaKey { userInfo["agendaKey"] = key }
    if let id = projectId { userInfo["projectId"] = id }
    c.userInfo = userInfo
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler done: @escaping () -> Void) {
    let info = response.notification.request.content.userInfo
    if let key = info["agendaKey"] as? String {
      // the item may have cleared since; then the dashboard shows what is left
      openAgendaItem(key, projectId: info["projectId"] as? String)
    } else if let url = info["url"] as? String { openInBrowser(url) }
    done()
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent n: UNNotification,
                              withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound])
  }

  /// Only for things you'd otherwise miss: a running server crashing, a launch failing while you're in
  /// another app, a script that ran over 20 s finishing. Nothing on the first poll, nothing for successes of launches.
  func checkForNews(_ list: [ProjectView]) {
    let first = seenStatus.isEmpty && seenScripts.isEmpty
    let browserInFront = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == browserBundleId()
    for p in list {
      let before = seenStatus[p.id]
      seenStatus[p.id] = p.status
      if !first, p.status == "failed", let before = before, before != "failed" {
        let why = p.error ?? "it stopped"
        if before == "running" {
          notify("\(p.name) stopped", why, open: dashboardUrl(p.id, "&tab=output"))
        } else if ["installing", "starting"].contains(before) && !browserInFront {
          notify("\(p.name) didn't start", why, open: dashboardUrl(p.id, "&tab=output"))
        }
      }
      for (name, s) in p.scripts ?? [:] {
        let key = "\(p.id)\u{0}\(name)"
        let was = seenScripts[key]
        seenScripts[key] = s.status
        guard !first, was == "running", s.status == "passed" || s.status == "failed", let end = s.endedAt,
              end - s.startedAt > 20_000 else { continue }
        let secs = Int((end - s.startedAt) / 1000)
        notify("\(p.name) · \(name) \(s.status)", "after \(secs / 60 > 0 ? "\(secs / 60) min \(secs % 60) s" : "\(secs) s")",
               open: dashboardUrl(p.id, "&tab=scripts"))
      }
    }
  }

  /// One notification per new Needs you item, on checkForNews's rules. Not while the assistant's app is in front:
  /// the owner is already where the item is. An item seen then stays seen.
  func checkAgendaNews(_ a: AgendaView) {
    let now = Set(a.needs.map { "\($0.key)\u{0}\($0.fingerprint)" })
    guard let seen = seenAgenda else { seenAgenda = now; return }
    seenAgenda = seen.union(now)
    if let app = setup.assistant?.bundleId, NSWorkspace.shared.frontmostApplication?.bundleIdentifier == app { return }
    for it in a.needs where !seen.contains("\(it.key)\u{0}\(it.fingerprint)") {
      notify(it.where, it.title, open: dashboardUrl(it.projectId), agendaKey: it.key, projectId: it.projectId)
    }
  }

  /// The Agenda rides along with every refresh, on its own request, so a slow one holds nothing up.
  func refreshAgenda() {
    request("api/config") { data in
      if let d = data, let s = try? JSONDecoder().decode(SetupView.self, from: d) { setup = s }
    }
    guard setup.on("agenda") else { agenda = nil; agendaData = nil; return }
    request("api/agenda") { [weak self] data in
      guard let self = self else { return }
      let a = data.flatMap { try? JSONDecoder().decode(AgendaView.self, from: $0) }
      self.agenda = a
      self.agendaData = a == nil ? nil : data
      if let a = a { self.checkAgendaNews(a) }
      self.setTitle(self.serviceDown ? nil : self.projects)
      self.redrawIfOpen()
    }
  }

  /// Fetches projects (and, when the menu opens, fresh icons so favicon edits show up), then redraws if open.
  func refresh(withIcons: Bool) {
    if refreshing { return }
    refreshing = true
    refreshAgenda()
    request("api/projects") { [weak self] data in
      guard let self = self else { return }
      let list = data.flatMap { try? JSONDecoder().decode([ProjectView].self, from: $0) }
      self.serviceDown = list == nil
      if let list = list { self.projects = list; self.projectsData = data; self.checkForNews(list) }
      self.setTitle(list)
      guard withIcons, let list = list else { self.refreshing = false; self.redrawIfOpen(); return }
      let group = DispatchGroup()
      var fresh: [String: NSImage] = [:]
      var freshData: [String: Data] = [:]
      for p in list where !p.hidden {
        group.enter()
        let enc = p.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? p.id
        request("api/icon/\(enc)", timeout: 2) { d in
          if let d = d, let img = NSImage(data: d) { img.size = NSSize(width: 18, height: 18); fresh[p.id] = img; freshData[p.id] = d }
          group.leave()
        }
      }
      group.notify(queue: .main) {
        self.icons.merge(fresh) { _, new in new }
        self.iconData.merge(freshData) { _, new in new }
        self.refreshing = false
        self.redrawIfOpen()
      }
    }
  }

  func signature() -> Int {
    var h = Hasher()
    h.combine(serviceDown)
    h.combine(projectsData)
    h.combine(agendaData)
    for k in iconData.keys.sorted() { h.combine(k); h.combine(iconData[k]) }
    return h.finalize()
  }

  func redrawIfOpen() { if menuOpen && signature() != drawnSignature { rebuild() } }

  func menuWillOpen(_ menu: NSMenu) { menuOpen = true }
  func menuDidClose(_ menu: NSMenu) { menuOpen = false }

  @discardableResult
  func add(_ title: String, icon: NSImage? = nil, detail: String? = nil, detailColor: NSColor = .secondaryLabelColor,
           enabled: Bool = true, alternate: NSEvent.ModifierFlags? = nil, key: String = "",
           to target: NSMenu? = nil, _ run: (() -> Void)? = nil) -> NSMenuItem {
    let mi = NSMenuItem(title: title, action: nil, keyEquivalent: key)
    if let detail = detail {
      let s = NSMutableAttributedString(string: title, attributes: [.font: NSFont.menuFont(ofSize: 0)])
      s.append(NSAttributedString(string: "   \(detail)", attributes: [.foregroundColor: detailColor, .font: NSFont.menuFont(ofSize: 11)]))
      mi.attributedTitle = s
    }
    mi.image = icon
    if let run = run {
      let a = Action(run); actions.append(a)
      mi.target = a; mi.action = #selector(Action.fire(_:))
    }
    mi.isEnabled = enabled && run != nil
    if let mod = alternate { mi.isAlternate = true; mi.keyEquivalentModifierMask = mod }
    (target ?? menu).addItem(mi)
    return mi
  }

  /// A running (or starting) project: its row opens a submenu of what can be done with it.
  func runningRow(_ p: ProjectView) {
    let errs = p.errors ?? 0
    let detail: String
    if errs > 0 && p.active { detail = "\(errs) error\(errs == 1 ? "" : "s")" }
    else if p.status == "running" { detail = p.kind == "window" ? "window" : p.port.map { ":\($0)" } ?? "" }
    else { detail = "\(p.status)…" }
    let ai = setup.assistant
    let working = p.assistant?.working == true
    let row = add(p.name, icon: icons[p.id], detail: working && errs == 0 ? "\(detail) · \(ai?.label ?? "assistant") working" : detail,
                  detailColor: errs > 0 ? .systemRed : working ? .systemOrange : .secondaryLabelColor)
    row.isEnabled = true
    row.toolTip = p.about?.description
    let sub = NSMenu()
    sub.autoenablesItems = false
    if p.status == "running", p.kind != "window", p.mode == "local", let url = p.url {
      // the stable address when there is one; the real port stays in the detail
      add(browserName == "default" ? "Open in browser" : "Open in \(browserName)", detail: p.port.map { ":\($0)" }, to: sub) { openInBrowser(p.page(url)) }
    }
    add("Stop", to: sub) { post("\(p.path)/stop") }
    if p.phone == true && p.mode == "local" && p.status == "running" {
      add("Restart for phone…", to: sub) { openInBrowser(dashboardUrl(p.id, "&phone=1")) }
    }
    add("Show output", to: sub) { openInBrowser(dashboardUrl(p.id, "&tab=output")) }
    if errs > 0 { add("Show \(errs) error\(errs == 1 ? "" : "s")", to: sub) { openInBrowser(dashboardUrl(p.id, "&tab=output&filter=errors")) } }
    let checks = (p.checks ?? []).filter { ["test", "typecheck"].contains($0) }
    if !checks.isEmpty {
      sub.addItem(.separator())
      for name in checks {
        let running = p.scripts?[name]?.status == "running"
        add(running ? "Running \(name)…" : "Run \(name)", enabled: !running, to: sub) { post("\(p.path)/scripts/\(name)/run") }
      }
    }
    sub.addItem(.separator())
    add("Open in \(setup.editor?.label ?? "VS Code")", to: sub) { post("\(p.path)/editor") }
    add("Show in Finder", to: sub) { post("\(p.path)/finder") }
    if let ai = ai, ai.can.open {
      add(p.assistantAction(ai.label), icon: ai.id == "claude" ? claudeLogo : nil, detail: working ? "working" : nil, to: sub) { post("\(p.path)/assistant") }
    }
    row.submenu = sub
  }

  func header(_ text: String) {
    let mi = NSMenuItem(title: text, action: nil, keyEquivalent: "")
    mi.attributedTitle = NSAttributedString(string: text, attributes: [.foregroundColor: NSColor.secondaryLabelColor, .font: NSFont.systemFont(ofSize: 11, weight: .semibold)])
    mi.isEnabled = false
    menu.addItem(mi)
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    rebuild()
    refresh(withIcons: true)
  }

  func rebuild() {
    drawnSignature = signature()
    menu.removeAllItems(); actions.removeAll()
    guard let all = projects, !serviceDown else {
      add(projects == nil && !serviceDown ? "Loading…" : "Oberth service not running", enabled: false)
      menu.addItem(.separator())
      add("Quit") { NSApp.terminate(nil) }
      return
    }
    let visible = all.filter { !$0.hidden }
    let running = visible.filter { $0.active }
    let foreign = visible.filter { !$0.active && !$0.foreign.isEmpty }
    // libraries (no dev server) have nothing to launch: they live in the dashboard only
    let rest = visible.filter { !$0.active && $0.foreign.isEmpty && $0.kind != "library" }
    setTitle(all)
    let path = { (p: ProjectView) in p.path }

    if let needs = agenda?.needs, !needs.isEmpty {
      header("NEEDS YOU")
      for it in needs.prefix(5) {
        let text = it.label.count > 60 ? String(it.label.prefix(59)) + "…" : it.label
        let row = add(text, icon: it.projectId.flatMap { icons[$0] }) { openAgendaItem(it.key, projectId: it.projectId) }
        row.toolTip = it.detail ?? it.title
      }
      add("Open Agenda", detail: needs.count > 5 ? "\(needs.count - 5) more" : nil) { openInBrowser(dashboardUrl()) }
      menu.addItem(.separator())
    }
    if !running.isEmpty {
      header("RUNNING")
      for p in running { runningRow(p) }
      add("Stop all") { post("api/stop-all") }
      menu.addItem(.separator())
    }
    if !foreign.isEmpty {
      header("NOT STARTED BY OBERTH")
      for p in foreign {
        let f = p.foreign[0]
        let page = p.page(p.foreignUrl ?? "http://localhost:\(f.port)/")
        if p.kind == "window" {
          add(p.name, icon: icons[p.id], detail: "window", enabled: false)   // no page for window apps
        } else {
          add(p.name, icon: icons[p.id], detail: ":\(f.port)") { openInBrowser(page) }
        }
        add("Stop \(p.name) (:\(f.port))", icon: icons[p.id], alternate: .option) { post("api/foreign/\(f.pid)/stop") }
      }
      menu.addItem(.separator())
    }
    header("LAUNCH")
    for p in rest {
      let failed = p.status == "failed"
      let working = p.assistant?.working == true
      // pre-flight findings are grey like the dashboard's: nothing has failed yet
      let pre = p.preflight ?? []
      let row = add(p.name, icon: icons[p.id], detail: failed ? "failed" : working ? "\(setup.assistant?.label ?? "assistant") working" : pre.first?.short ?? (p.kind == "window" ? "window" : nil),
                    detailColor: failed ? .systemRed : working ? .systemOrange : .secondaryLabelColor) { post("\(path(p))/launch", ["mode": "local"]) }
      let preText = pre.map { $0.text }.joined(separator: "\n")
      row.toolTip = [failed ? p.error : p.about?.description, preText.isEmpty ? nil : preText].compactMap { $0 }.joined(separator: "\n\n")
      if let ai = setup.assistant, ai.can.open {
        add("\(ai.label) in \(p.name)", icon: (ai.id == "claude" ? claudeLogo : nil) ?? icons[p.id], detail: p.assistant == nil ? "new session" : "open session", alternate: .option) { post("\(path(p))/assistant") }
      }
      if let repo = p.repoUrl {
        add(repo.hasPrefix("https://github.com/") ? "Open \(p.name) on GitHub" : "Open \(p.name)'s repository", icon: icons[p.id], alternate: .shift) { openInBrowser(repo) }
      }
      // after the ⌥/⇧ alternates, which must directly follow their row
      // a launch that failed on a taken port: offer to stop the holder when Oberth may (never one that isn't a discovered project)
      if failed, let c = p.conflict, c.holder.kind != "other" {
        let what = c.holder.kind == "launched" ? "Stop \(c.holder.name ?? "it") and retry" : "Stop the leftover and retry"
        let fix = add(what, detail: ":\(c.port) in use", detailColor: .systemRed) { post("\(path(p))/free-port") }
        fix.indentationLevel = 1
      }
    }
    menu.addItem(.separator())
    // after the menu closes, so the panel isn't opened from inside menu tracking
    if setup.on("ideas") { add("New idea…", key: "i") { [weak self] in DispatchQueue.main.async { self?.newIdea() } } }
    add("Open dashboard", key: "d") { openInBrowser(dashboardUrl()) }
    add("Quit Oberth", key: "q") { NSApp.terminate(nil) }
    fitWidthToAlternates()
  }

  /// "New idea…": a title, an optional note and what it is for (a new project, or one that exists), saved to Ideas
  /// (docs/architecture.md, "Ideas"). Nothing waits on the network but the save itself.
  func newIdea() {
    let width: CGFloat = 320
    let title = NSTextField(frame: NSRect(x: 0, y: 0, width: width, height: 24))
    title.placeholderString = "An idea, in a few words"
    let note = NSTextField(frame: NSRect(x: 0, y: 0, width: width, height: 64))
    note.placeholderString = "A note or a link (optional)"
    note.usesSingleLineMode = false
    note.cell?.wraps = true
    note.cell?.isScrollable = false
    note.lineBreakMode = .byWordWrapping
    let pick = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: width, height: 26), pullsDown: false)
    pick.addItem(withTitle: "New project")
    let targets = (projects ?? []).filter { !$0.hidden }.map { ($0.id, $0.name) }.sorted { $0.1.localizedCaseInsensitiveCompare($1.1) == .orderedAscending } + [("oberth", "Oberth")]
    for (id, name) in targets {
      pick.addItem(withTitle: name)
      pick.lastItem?.representedObject = id
    }
    let stack = NSStackView(views: [title, note, pick])
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 8
    for v in [title, note, pick] { v.widthAnchor.constraint(equalToConstant: width).isActive = true }
    note.heightAnchor.constraint(equalToConstant: 64).isActive = true
    stack.frame = NSRect(x: 0, y: 0, width: width, height: 24 + 64 + 26 + 16)

    let alert = NSAlert()
    alert.messageText = "New idea"
    alert.informativeText = "Goes to Ideas in the dashboard. Pick a project if it is for one that exists."
    alert.addButton(withTitle: "Save")
    alert.addButton(withTitle: "Cancel")
    alert.accessoryView = stack
    alert.layout()
    alert.window.initialFirstResponder = title
    NSApp.activate(ignoringOtherApps: true)
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    let t = title.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty else { return }
    var body = ["title": String(t.prefix(120)), "source": "menu"]
    let n = note.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    if !n.isEmpty { body["note"] = String(n.prefix(4000)) }
    if let id = pick.selectedItem?.representedObject as? String { body["projectId"] = id }
    request("api/ideas", method: "POST", body: body, timeout: 10) { data in
      guard data == nil else { return }
      let failed = NSAlert()
      failed.messageText = "The idea wasn't saved"
      failed.informativeText = "Oberth's service didn't answer. Here is what you typed:\n\n\(t)\(n.isEmpty ? "" : "\n\n\(n)")"
      NSApp.activate(ignoringOtherApps: true)
      failed.runModal()
    }
  }

  /// AppKit sizes a menu from the rows it shows, ignoring hidden ⌥/⇧ alternates, so revealing a wider
  /// alternate grows the open menu (and it never shrinks back). Reserve the widest row's width up front.
  func fitWidthToAlternates() {
    let font = NSFont.menuFont(ofSize: 0)
    var widest: CGFloat = 0
    for mi in menu.items where !mi.isSeparatorItem {
      let text = mi.attributedTitle ?? NSAttributedString(string: mi.title, attributes: [.font: font])
      widest = max(widest, ceil(text.size().width) + (mi.image.map { $0.size.width + 6 } ?? 0))
    }
    // left inset for the checkmark column plus right padding, as AppKit lays out menu rows
    menu.minimumWidth = widest + 42
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
