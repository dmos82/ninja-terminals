# macOS Accessibility API Patterns — Deep Research

**Date:** 2026-03-23
**Purpose:** Production-grade patterns for finding/clicking buttons, enumerating UI elements, handling Metal-rendered apps, and building hybrid automation.

---

## Table of Contents

1. [Prerequisites & Permissions](#1-prerequisites--permissions)
2. [Finding and Clicking Buttons in Modal Dialogs](#2-finding-and-clicking-buttons-in-modal-dialogs)
3. [Enumerating ALL Clickable Elements](#3-enumerating-all-clickable-elements)
4. [Metal/Custom-Rendered App Support](#4-metalcustom-rendered-app-support)
5. [Advanced Patterns](#5-advanced-patterns)
6. [Hybrid Approach: AX + CGEvent](#6-hybrid-approach-ax--cgevent)
7. [Performance Considerations](#7-performance-considerations)
8. [Complete AX Role Reference](#8-complete-ax-role-reference)
9. [Error Handling Reference](#9-error-handling-reference)
10. [Libraries & Tools](#10-libraries--tools)

---

## 1. Prerequisites & Permissions

### Accessibility Permission Check

```swift
import ApplicationServices

func checkAccessibilityPermission() -> Bool {
    // Check current status without prompting
    let checkOptPrompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [checkOptPrompt: false] as CFDictionary
    let trusted = AXIsProcessTrustedWithOptions(options)
    return trusted
}

func requestAccessibilityPermission() {
    // Check and prompt user if not granted
    let checkOptPrompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [checkOptPrompt: true] as CFDictionary
    AXIsProcessTrustedWithOptions(options)
}
```

### Required Entitlements

Your app **must** be non-sandboxed to use the AX client API. If sandboxed, `AXUIElementCopyAttributeValue` will return `kAXErrorCannotComplete`.

```xml
<!-- Entitlements.plist -->
<key>com.apple.security.app-sandbox</key>
<false/>
```

### Setting a Messaging Timeout

AX calls are synchronous and will block. Default timeout is ~6 seconds.

```swift
// Set per-element timeout (in seconds)
AXUIElementSetMessagingTimeout(element, 3.0)

// Set global timeout for all AX calls
// (not commonly available — use per-element)
```

---

## 2. Finding and Clicking Buttons in Modal Dialogs

### Complete Flow: Raw C API

```swift
import ApplicationServices
import AppKit

// MARK: - Core AXUIElement Helpers

/// Get an attribute value from an AXUIElement
func axAttribute<T>(_ element: AXUIElement, _ attribute: String) -> T? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success else { return nil }
    return value as? T
}

/// Get children of an element
func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    guard let children: CFArray = axAttribute(element, kAXChildrenAttribute) else {
        return []
    }
    return (0..<CFArrayGetCount(children)).compactMap { index in
        let raw = CFArrayGetValueAtIndex(children, index)
        return (raw as! AXUIElement)
    }
}

/// Get the role of an element
func axRole(_ element: AXUIElement) -> String? {
    return axAttribute(element, kAXRoleAttribute)
}

/// Get the title of an element
func axTitle(_ element: AXUIElement) -> String? {
    return axAttribute(element, kAXTitleAttribute)
}

/// Get the subrole of an element
func axSubrole(_ element: AXUIElement) -> String? {
    return axAttribute(element, kAXSubroleAttribute)
}

/// Get the value of an element
func axValue(_ element: AXUIElement) -> Any? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value)
    guard result == .success else { return nil }
    return value
}

/// Get the description of an element
func axDescription(_ element: AXUIElement) -> String? {
    return axAttribute(element, kAXDescriptionAttribute)
}

/// Perform an action on an element
func axPerformAction(_ element: AXUIElement, _ action: String) -> Bool {
    let result = AXUIElementPerformAction(element, action as CFString)
    return result == .success
}

/// Check if an attribute is settable
func axIsSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
    var settable: DarwinBoolean = false
    let result = AXUIElementIsAttributeSettable(element, attribute as CFString, &settable)
    return result == .success && settable.boolValue
}

/// Set an attribute value
func axSetAttribute(_ element: AXUIElement, _ attribute: String, _ value: CFTypeRef) -> Bool {
    let result = AXUIElementSetAttributeValue(element, attribute as CFString, value)
    return result == .success
}
```

### Finding and Clicking a Button in a Modal Dialog

```swift
/// Find a running application by bundle identifier
func findApp(bundleID: String) -> AXUIElement? {
    let workspace = NSWorkspace.shared
    guard let app = workspace.runningApplications.first(where: {
        $0.bundleIdentifier == bundleID
    }) else {
        return nil
    }
    return AXUIElementCreateApplication(app.processIdentifier)
}

/// Get all windows of an application (including sheets/dialogs)
func getWindows(_ appElement: AXUIElement) -> [AXUIElement] {
    return axChildren(appElement).filter { axRole($0) == "AXWindow" }
}

/// Find modal sheets attached to a window
func findSheets(in window: AXUIElement) -> [AXUIElement] {
    return axChildren(window).filter { axRole($0) == "AXSheet" }
}

/// Find dialogs (separate modal windows)
func findDialogs(in appElement: AXUIElement) -> [AXUIElement] {
    return getWindows(appElement).filter { element in
        let subrole = axSubrole(element)
        return subrole == "AXDialog" || subrole == "AXSystemDialog"
    }
}

/// Recursively find a button by title in an element tree
func findButton(in element: AXUIElement, title: String) -> AXUIElement? {
    let role = axRole(element)
    let elementTitle = axTitle(element)

    if role == "AXButton" && elementTitle == title {
        return element
    }

    for child in axChildren(element) {
        if let found = findButton(in: child, title: title) {
            return found
        }
    }
    return nil
}

/// Find a button by partial title match (fuzzy)
func findButtonFuzzy(in element: AXUIElement, containing text: String) -> AXUIElement? {
    let role = axRole(element)
    let elementTitle = axTitle(element) ?? ""

    if role == "AXButton" && elementTitle.localizedCaseInsensitiveContains(text) {
        return element
    }

    for child in axChildren(element) {
        if let found = findButtonFuzzy(in: child, containing: text) {
            return found
        }
    }
    return nil
}

/// Click a button using AXPress action
func clickButton(_ button: AXUIElement) -> Bool {
    return axPerformAction(button, kAXPressAction)
}

// MARK: - Complete Usage Example

func clickDialogButton(appBundleID: String, buttonTitle: String) -> Bool {
    guard let appElement = findApp(bundleID: appBundleID) else {
        print("App not found")
        return false
    }

    // Strategy 1: Check for sheets in each window
    for window in getWindows(appElement) {
        for sheet in findSheets(in: window) {
            if let button = findButton(in: sheet, title: buttonTitle) {
                return clickButton(button)
            }
        }
    }

    // Strategy 2: Check for dialog windows
    for dialog in findDialogs(in: appElement) {
        if let button = findButton(in: dialog, title: buttonTitle) {
            return clickButton(button)
        }
    }

    // Strategy 3: Search all windows (fallback)
    for window in getWindows(appElement) {
        if let button = findButton(in: window, title: buttonTitle) {
            return clickButton(button)
        }
    }

    print("Button '\(buttonTitle)' not found")
    return false
}

// Usage:
// clickDialogButton(appBundleID: "com.apple.Safari", buttonTitle: "Allow")
// clickDialogButton(appBundleID: "com.apple.logic10", buttonTitle: "OK")
```

### Finding by Role + Description (for buttons without titles)

```swift
/// Some buttons have descriptions instead of titles (e.g., toolbar buttons)
func findButtonByDescription(in element: AXUIElement, description: String) -> AXUIElement? {
    let role = axRole(element)
    let desc = axDescription(element) ?? ""

    if role == "AXButton" && desc.localizedCaseInsensitiveContains(description) {
        return element
    }

    for child in axChildren(element) {
        if let found = findButtonByDescription(in: child, description: description) {
            return found
        }
    }
    return nil
}

/// Find by role + identifier (AXIdentifier, used by some apps)
func findElementByIdentifier(in element: AXUIElement, identifier: String) -> AXUIElement? {
    let elementID: String? = axAttribute(element, "AXIdentifier")
    if elementID == identifier {
        return element
    }
    for child in axChildren(element) {
        if let found = findElementByIdentifier(in: child, identifier: identifier) {
            return found
        }
    }
    return nil
}
```

---

## 3. Enumerating ALL Clickable Elements

### Clickable AX Roles

These roles support the `AXPress` action or are otherwise interactive:

| Role | String Value | Primary Action | Notes |
|------|-------------|----------------|-------|
| `kAXButtonRole` | "AXButton" | AXPress | Standard buttons |
| `kAXRadioButtonRole` | "AXRadioButton" | AXPress | Radio buttons |
| `kAXCheckBoxRole` | "AXCheckBox" | AXPress | Checkboxes, toggles |
| `kAXPopUpButtonRole` | "AXPopUpButton" | AXPress / AXShowMenu | Dropdown menus |
| `kAXMenuButtonRole` | "AXMenuButton" | AXPress / AXShowMenu | Menu buttons |
| `kAXMenuItemRole` | "AXMenuItem" | AXPress | Menu items |
| `kAXMenuBarItemRole` | "AXMenuBarItem" | AXPress | Menu bar items |
| `kAXDisclosureTriangleRole` | "AXDisclosureTriangle" | AXPress | Expand/collapse |
| `kAXSliderRole` | "AXSlider" | AXIncrement / AXDecrement | Drag or step |
| `kAXIncrementorRole` | "AXIncrementor" | AXIncrement / AXDecrement | Stepper controls |
| `kAXComboBoxRole` | "AXComboBox" | AXPress | Combo box dropdown |
| `kAXColorWellRole` | "AXColorWell" | AXPress | Color picker |
| `kAXTabGroupRole` | "AXTabGroup" | — | Children are clickable tabs |
| `kAXLinkRole` | "AXLink" | AXPress | Hyperlinks |
| `kAXCellRole` | "AXCell" | AXPress | Table/grid cells |
| `kAXTextFieldRole` | "AXTextField" | AXConfirm | Editable text |
| `kAXTextAreaRole` | "AXTextArea" | — | Multi-line text |

### Building a Complete Target Map

```swift
/// Represents a clickable UI element with all info needed to interact with it
struct ClickTarget {
    let element: AXUIElement
    let role: String
    let title: String?
    let description: String?
    let value: Any?
    let identifier: String?
    let frame: CGRect
    let actions: [String]
    let isEnabled: Bool
    let depth: Int

    /// Best human-readable label for this element
    var label: String {
        return title ?? description ?? identifier ?? role
    }

    /// Whether this element supports a press/click action
    var isClickable: Bool {
        return actions.contains(kAXPressAction) ||
               actions.contains(kAXShowMenuAction) ||
               actions.contains("AXOpen")
    }
}

/// Get the frame (position + size) of an element in screen coordinates
func axFrame(_ element: AXUIElement) -> CGRect {
    var positionValue: CFTypeRef?
    var sizeValue: CFTypeRef?

    let posResult = AXUIElementCopyAttributeValue(
        element, kAXPositionAttribute as CFString, &positionValue
    )
    let sizeResult = AXUIElementCopyAttributeValue(
        element, kAXSizeAttribute as CFString, &sizeValue
    )

    guard posResult == .success, sizeResult == .success else {
        return .zero
    }

    var position = CGPoint.zero
    var size = CGSize.zero

    if let posValue = positionValue {
        AXValueGetValue(posValue as! AXValue, .cgPoint, &position)
    }
    if let szValue = sizeValue {
        AXValueGetValue(szValue as! AXValue, .cgSize, &size)
    }

    return CGRect(origin: position, size: size)
}

/// Get available actions for an element
func axActions(_ element: AXUIElement) -> [String] {
    var actionsRef: CFArray?
    let result = AXUIElementCopyActionNames(element, &actionsRef)
    guard result == .success, let actions = actionsRef as? [String] else {
        return []
    }
    return actions
}

/// Check if an element is enabled
func axIsEnabled(_ element: AXUIElement) -> Bool {
    let enabled: Bool? = axAttribute(element, kAXEnabledAttribute)
    return enabled ?? true  // Default to true if attribute not present
}

/// Roles that are potentially interactive/clickable
let interactiveRoles: Set<String> = [
    "AXButton", "AXRadioButton", "AXCheckBox", "AXPopUpButton",
    "AXMenuButton", "AXMenuItem", "AXMenuBarItem", "AXComboBox",
    "AXDisclosureTriangle", "AXSlider", "AXIncrementor", "AXColorWell",
    "AXLink", "AXCell", "AXTextField", "AXTextArea", "AXTabGroup",
    "AXImage",     // Sometimes clickable (toolbar icons)
    "AXStaticText" // Sometimes clickable (styled links in web views)
]

/// Recursively enumerate ALL clickable elements in a window
func enumerateClickTargets(
    in element: AXUIElement,
    depth: Int = 0,
    maxDepth: Int = 50,  // Safety limit
    targets: inout [ClickTarget]
) {
    guard depth < maxDepth else { return }

    let role = axRole(element) ?? "AXUnknown"
    let actions = axActions(element)
    let hasClickAction = actions.contains(kAXPressAction) ||
                         actions.contains(kAXShowMenuAction) ||
                         actions.contains("AXOpen") ||
                         actions.contains(kAXIncrementAction) ||
                         actions.contains(kAXDecrementAction)

    // Include if it's an interactive role OR has a click action
    if interactiveRoles.contains(role) || hasClickAction {
        let target = ClickTarget(
            element: element,
            role: role,
            title: axTitle(element),
            description: axDescription(element),
            value: axValue(element),
            identifier: axAttribute(element, "AXIdentifier"),
            frame: axFrame(element),
            actions: actions,
            isEnabled: axIsEnabled(element),
            depth: depth
        )
        targets.append(target)
    }

    // Recurse into children
    for child in axChildren(element) {
        enumerateClickTargets(in: child, depth: depth + 1, maxDepth: maxDepth, targets: &targets)
    }
}

/// Build a complete target map for an application
func buildTargetMap(appBundleID: String) -> [ClickTarget] {
    guard let appElement = findApp(bundleID: appBundleID) else {
        return []
    }

    var targets: [ClickTarget] = []

    // Enumerate all windows
    for window in getWindows(appElement) {
        enumerateClickTargets(in: window, targets: &targets)
    }

    return targets
}

// Usage:
// let targets = buildTargetMap(appBundleID: "com.apple.Safari")
// for target in targets {
//     print("[\(target.role)] \(target.label) at \(target.frame) — actions: \(target.actions)")
// }
```

### Depth-Limited Search with Early Termination

```swift
/// Find the first element matching a predicate (faster than full enumeration)
func findFirst(
    in element: AXUIElement,
    depth: Int = 0,
    maxDepth: Int = 50,
    where predicate: (AXUIElement, String?, String?) -> Bool
) -> AXUIElement? {
    let role = axRole(element)
    let title = axTitle(element)

    if predicate(element, role, title) {
        return element
    }

    guard depth < maxDepth else { return nil }

    for child in axChildren(element) {
        if let found = findFirst(in: child, depth: depth + 1, maxDepth: maxDepth, where: predicate) {
            return found
        }
    }
    return nil
}

// Usage: Find the first enabled "Save" button
// let saveBtn = findFirst(in: window) { element, role, title in
//     role == "AXButton" && title == "Save" && axIsEnabled(element)
// }
```

---

## 4. Metal/Custom-Rendered App Support

### The Reality of Metal-Rendered Apps

**Key finding:** Metal-rendered apps (Logic Pro, Final Cut Pro, etc.) do **not** automatically expose their custom-rendered UI elements through the accessibility tree. The accessibility tree only contains elements that the developer has explicitly made accessible.

**What happens with Metal rendering:**
- Metal draws pixels directly to the GPU — the accessibility system has zero knowledge of what's rendered
- Standard AppKit controls (NSButton, NSSlider, etc.) automatically expose accessibility
- Custom-drawn controls in Metal/Core Graphics **must** manually create `NSAccessibilityElement` objects
- If the developer didn't add accessibility support, those controls are invisible to the AX tree

### Logic Pro Specifics

Based on research from VoiceOver users and accessibility audits:

**What IS exposed in Logic Pro's AX tree:**
- Transport controls (Play, Stop, Record) — these use standard AppKit
- Menu bar and all menus
- Track headers (partially — track names, mute/solo buttons)
- Mixer channel strip faders and knobs (basic level)
- Plugin parameters in "Controls View" mode (when explicitly enabled in Preferences)
- Inspector panels
- Some toolbar buttons

**What is NOT exposed or poorly exposed:**
- Piano Roll note grid (custom Metal rendering)
- Waveform display / audio regions
- Automation lane drawing
- MIDI environment objects
- Performance meters
- Complex plugin GUIs (Alchemy's visual interface)
- Flex pitch/time markers
- Live Loop cell playing status
- Many custom visual indicators

### How Developers Expose Custom Controls

If you're building an app with Metal and need accessibility:

```swift
import AppKit

class MetalCanvasView: NSView {

    // Custom buttons drawn via Metal
    private var metalButtons: [(label: String, frame: CGRect)] = []
    private var accessibilityElements: [NSAccessibilityElement] = []

    func updateAccessibilityElements() {
        // Clear old elements
        accessibilityElements.removeAll()

        for buttonInfo in metalButtons {
            let element = NSAccessibilityElement()
            element.setAccessibilityRole(.button)
            element.setAccessibilityLabel(buttonInfo.label)
            element.setAccessibilityParent(self)

            // CRITICAL: Use accessibilityFrameInParentSpace, NOT accessibilityFrame
            // This ensures the element moves with its parent view
            element.setAccessibilityFrameInParentSpace(buttonInfo.frame)

            // Add to our tracking array
            accessibilityElements.append(element)
        }
    }

    // Required: Return custom elements as accessibility children
    override func accessibilityChildren() -> [Any]? {
        return accessibilityElements
    }

    // Required: Respond to hit-testing
    override func accessibilityHitTest(_ point: NSPoint) -> Any? {
        let localPoint = convert(point, from: nil)
        for element in accessibilityElements {
            if element.accessibilityFrameInParentSpace().contains(localPoint) {
                return element
            }
        }
        return self
    }

    // Post notifications when state changes
    func buttonStateChanged(_ element: NSAccessibilityElement) {
        NSAccessibilityPostNotification(element, .valueChanged)
    }
}
```

### Checking What's Available with Accessibility Inspector

**Method 1: Accessibility Inspector (Xcode developer tool)**
```bash
# Open Accessibility Inspector
open -a "Accessibility Inspector"
```
Then hover over elements in the target app — the inspector shows:
- Role, Subrole
- Title, Description, Value
- Position, Size
- Available Actions
- Parent/Children hierarchy

**Method 2: Programmatic Discovery**

```swift
/// Dump the entire accessibility tree of an app for analysis
func dumpAXTree(
    _ element: AXUIElement,
    depth: Int = 0,
    maxDepth: Int = 10
) {
    guard depth < maxDepth else {
        print(String(repeating: "  ", count: depth) + "... (max depth)")
        return
    }

    let indent = String(repeating: "  ", count: depth)
    let role = axRole(element) ?? "?"
    let title = axTitle(element) ?? ""
    let desc = axDescription(element) ?? ""
    let subrole = axSubrole(element) ?? ""
    let actions = axActions(element)
    let frame = axFrame(element)
    let value = axValue(element)
    let identifier: String? = axAttribute(element, "AXIdentifier")

    var line = "\(indent)[\(role)]"
    if !subrole.isEmpty { line += " (\(subrole))" }
    if !title.isEmpty { line += " title=\"\(title)\"" }
    if !desc.isEmpty { line += " desc=\"\(desc)\"" }
    if let id = identifier { line += " id=\"\(id)\"" }
    if let v = value { line += " value=\(v)" }
    if frame != .zero { line += " frame=\(frame)" }
    if !actions.isEmpty { line += " actions=\(actions)" }

    print(line)

    for child in axChildren(element) {
        dumpAXTree(child, depth: depth + 1, maxDepth: maxDepth)
    }
}

// Usage:
// guard let app = findApp(bundleID: "com.apple.logic10") else { return }
// for window in getWindows(app) {
//     dumpAXTree(window, maxDepth: 5)
// }
```

### Workaround: Hit-Test Grid Scan for Opaque Apps

When an app doesn't expose its tree properly, you can scan the screen at grid points:

```swift
/// Scan a rectangular area using AXUIElementCopyElementAtPosition
/// to discover elements not exposed through normal tree traversal
func gridScan(
    appElement: AXUIElement,
    bounds: CGRect,
    stepSize: CGFloat = 20
) -> [AXUIElement: CGRect] {
    var discovered: [String: (element: AXUIElement, frame: CGRect)] = [:]

    var y = bounds.origin.y
    while y < bounds.maxY {
        var x = bounds.origin.x
        while x < bounds.maxX {
            var elementRef: AXUIElement?
            let result = AXUIElementCopyElementAtPosition(
                appElement, Float(x), Float(y), &elementRef
            )

            if result == .success, let element = elementRef {
                let role = axRole(element) ?? "unknown"
                let title = axTitle(element) ?? ""
                let key = "\(role)_\(title)_\(axFrame(element))"

                if discovered[key] == nil {
                    discovered[key] = (element: element, frame: axFrame(element))
                }
            }
            x += stepSize
        }
        y += stepSize
    }

    var result: [AXUIElement: CGRect] = [:]
    for (_, value) in discovered {
        result[value.element] = value.frame
    }
    return result
}
```

---

## 5. Advanced Patterns

### 5A. AXObserver — Watching for New Windows/Dialogs

```swift
import ApplicationServices

class AccessibilityWatcher {
    private var observers: [pid_t: AXObserver] = [:]

    /// Available notification constants
    /// kAXWindowCreatedNotification       — new window appeared
    /// kAXUIElementDestroyedNotification  — element removed
    /// kAXFocusedWindowChangedNotification — different window focused
    /// kAXFocusedUIElementChangedNotification — focus moved to different element
    /// kAXMainWindowChangedNotification   — main window changed
    /// kAXSheetCreatedNotification        — sheet (modal dialog) appeared
    /// kAXDrawerCreatedNotification       — drawer appeared
    /// kAXValueChangedNotification        — element value changed
    /// kAXWindowMovedNotification         — window position changed
    /// kAXWindowResizedNotification       — window size changed
    /// kAXWindowMiniaturizedNotification  — window minimized
    /// kAXWindowDeminiaturizedNotification — window unminimized
    /// kAXTitleChangedNotification        — title changed
    /// kAXApplicationActivatedNotification — app became active
    /// kAXApplicationDeactivatedNotification — app lost focus
    /// kAXApplicationHiddenNotification   — app hidden
    /// kAXApplicationShownNotification    — app shown
    /// kAXSelectedChildrenChangedNotification — selection changed
    /// kAXMenuOpenedNotification          — menu opened
    /// kAXMenuClosedNotification          — menu closed
    /// kAXMenuItemSelectedNotification    — menu item highlighted

    /// Watch an application for new windows and sheets
    func watchApp(pid: pid_t, handler: @escaping (AXUIElement, String) -> Void) {
        // Store handler for callback
        let context = WatcherContext(handler: handler)
        let contextPtr = Unmanaged.passRetained(context).toOpaque()

        var observer: AXObserver?
        let callbackFn: AXObserverCallback = { (
            _ observer: AXObserver,
            _ element: AXUIElement,
            _ notification: CFString,
            _ refcon: UnsafeMutableRawPointer?
        ) in
            guard let refcon = refcon else { return }
            let ctx = Unmanaged<WatcherContext>.fromOpaque(refcon).takeUnretainedValue()
            ctx.handler(element, notification as String)
        }

        let createResult = AXObserverCreate(pid, callbackFn, &observer)
        guard createResult == .success, let obs = observer else {
            print("Failed to create observer: \(createResult)")
            return
        }

        let appElement = AXUIElementCreateApplication(pid)

        // Register for dialog/window notifications
        let notifications = [
            kAXWindowCreatedNotification,
            kAXSheetCreatedNotification,
            kAXDrawerCreatedNotification,
            kAXFocusedWindowChangedNotification,
            kAXFocusedUIElementChangedNotification
        ]

        for notif in notifications {
            AXObserverAddNotification(obs, appElement, notif as CFString, contextPtr)
        }

        // Add to run loop — CRITICAL: without this, callbacks never fire
        CFRunLoopAddSource(
            CFRunLoopGetCurrent(),
            AXObserverGetRunLoopSource(obs),
            .defaultMode
        )

        observers[pid] = obs
    }

    /// Stop watching an application
    func stopWatching(pid: pid_t) {
        guard let obs = observers[pid] else { return }
        CFRunLoopRemoveSource(
            CFRunLoopGetCurrent(),
            AXObserverGetRunLoopSource(obs),
            .defaultMode
        )
        observers.removeValue(forKey: pid)
    }

    deinit {
        for (pid, _) in observers {
            stopWatching(pid: pid)
        }
    }
}

class WatcherContext {
    let handler: (AXUIElement, String) -> Void
    init(handler: @escaping (AXUIElement, String) -> Void) {
        self.handler = handler
    }
}

// Usage:
//
// let watcher = AccessibilityWatcher()
//
// let pid = NSRunningApplication.runningApplications(
//     withBundleIdentifier: "com.apple.Safari"
// ).first!.processIdentifier
//
// watcher.watchApp(pid: pid) { element, notification in
//     print("Notification: \(notification)")
//     let role = axRole(element) ?? "unknown"
//     let title = axTitle(element) ?? ""
//     print("  Element: [\(role)] \(title)")
//
//     if notification == kAXSheetCreatedNotification as String {
//         // A modal sheet appeared! Find and click a button in it.
//         if let okButton = findButton(in: element, title: "OK") {
//             clickButton(okButton)
//         }
//     }
// }
//
// // Run the main run loop (needed for callbacks)
// RunLoop.current.run()
```

### 5B. Using kAXFocusedUIElementAttribute

```swift
/// Get the currently focused element in any application
func getFocusedElement() -> AXUIElement? {
    let systemWide = AXUIElementCreateSystemWide()
    var focusedElement: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(
        systemWide,
        kAXFocusedUIElementAttribute as CFString,
        &focusedElement
    )
    guard result == .success else { return nil }
    return (focusedElement as! AXUIElement)
}

/// Get the focused element within a specific application
func getFocusedElement(inApp appElement: AXUIElement) -> AXUIElement? {
    return axAttribute(appElement, kAXFocusedUIElementAttribute)
}

/// Get the focused window of an application
func getFocusedWindow(inApp appElement: AXUIElement) -> AXUIElement? {
    return axAttribute(appElement, kAXFocusedWindowAttribute)
}

/// Get the main window of an application
func getMainWindow(inApp appElement: AXUIElement) -> AXUIElement? {
    return axAttribute(appElement, kAXMainWindowAttribute)
}
```

### 5C. Setting Text Field Values

```swift
/// Set the value of a text field
func setTextFieldValue(_ element: AXUIElement, text: String) -> Bool {
    guard axIsSettable(element, kAXValueAttribute) else {
        print("Text field value is not settable")
        return false
    }
    return axSetAttribute(element, kAXValueAttribute, text as CFTypeRef)
}

/// Set focus to an element, then set its value
func focusAndSetText(_ element: AXUIElement, text: String) -> Bool {
    // First, set focus
    _ = axSetAttribute(element, kAXFocusedAttribute, true as CFTypeRef)
    usleep(50_000) // 50ms for focus to settle

    // Then set value
    return setTextFieldValue(element, text: text)
}

/// Insert text at the current selection point (like typing)
func insertTextAtCursor(_ element: AXUIElement, text: String) -> Bool {
    guard axIsSettable(element, kAXSelectedTextAttribute) else {
        return false
    }
    return axSetAttribute(element, kAXSelectedTextAttribute, text as CFTypeRef)
}

/// Select all text in a text field
func selectAllText(_ element: AXUIElement) -> Bool {
    // Get the length of the current value
    guard let value: String = axAttribute(element, kAXValueAttribute) else {
        return false
    }

    let range = CFRange(location: 0, length: value.count)
    var axValue: AXValue?
    axValue = AXValueCreate(.cfRange, &range as UnsafeRawPointer as! UnsafePointer<CFRange>)

    guard let rangeValue = axValue else { return false }
    return axSetAttribute(element, kAXSelectedTextRangeAttribute, rangeValue)
}
```

### 5D. Error Handling

```swift
/// Comprehensive AX operation with error handling
enum AXOperationError: Error, CustomStringConvertible {
    case notTrusted
    case invalidElement
    case attributeUnsupported(String)
    case cannotComplete(String)
    case actionUnsupported(String)
    case notificationUnsupported
    case notImplemented
    case timeout
    case unknown(AXError)

    var description: String {
        switch self {
        case .notTrusted: return "App not trusted for accessibility"
        case .invalidElement: return "AX element is invalid (window closed?)"
        case .attributeUnsupported(let attr): return "Attribute unsupported: \(attr)"
        case .cannotComplete(let detail): return "Cannot complete: \(detail)"
        case .actionUnsupported(let action): return "Action unsupported: \(action)"
        case .notificationUnsupported: return "Notification not supported"
        case .notImplemented: return "Not implemented by app"
        case .timeout: return "AX operation timed out"
        case .unknown(let error): return "Unknown AX error: \(error.rawValue)"
        }
    }
}

func axAttributeSafe<T>(_ element: AXUIElement, _ attribute: String) throws -> T? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

    switch result {
    case .success:
        return value as? T
    case .attributeUnsupported:
        throw AXOperationError.attributeUnsupported(attribute)
    case .invalidUIElement:
        throw AXOperationError.invalidElement
    case .cannotComplete:
        // This often means the app is busy or the element was destroyed
        throw AXOperationError.cannotComplete(attribute)
    case .notImplemented:
        throw AXOperationError.notImplemented
    case .apiDisabled:
        throw AXOperationError.notTrusted
    case .noValue:
        return nil  // Attribute exists but has no value — not an error
    case .parameterizedAttributeUnsupported:
        throw AXOperationError.attributeUnsupported(attribute)
    default:
        throw AXOperationError.unknown(result)
    }
}

/// Retry an AX operation with exponential backoff
func axRetry<T>(
    maxAttempts: Int = 3,
    initialDelay: useconds_t = 50_000,  // 50ms
    operation: () throws -> T?
) throws -> T? {
    var delay = initialDelay
    for attempt in 1...maxAttempts {
        do {
            return try operation()
        } catch AXOperationError.cannotComplete(_) {
            if attempt < maxAttempts {
                usleep(delay)
                delay *= 2  // Exponential backoff
                continue
            }
            throw AXOperationError.timeout
        } catch AXOperationError.invalidElement {
            // Element is gone — no point retrying
            throw AXOperationError.invalidElement
        }
    }
    return nil
}
```

---

## 6. Hybrid Approach: AX + CGEvent

### When to Use Each Approach

| Approach | When to Use | Pros | Cons |
|----------|-------------|------|------|
| **AXPress** | Standard buttons, checkboxes, menu items | Reliable, doesn't move cursor, works even if element is off-screen | Some custom controls don't respond |
| **CGEvent click** | Metal-rendered controls, game UIs, custom views | Works on anything visible on screen | Moves the cursor, requires element to be visible, affected by window layering |
| **AppleScript** | Menu commands, app-specific scripting | High-level, resilient to UI changes | Slow, limited to what's scriptable |

### Fallback Chain Implementation

```swift
import ApplicationServices
import CoreGraphics

enum ClickResult {
    case axPressSuccess
    case cgEventSuccess
    case appleScriptSuccess
    case failed(String)
}

/// Click an element using the best available method with fallback
func clickWithFallback(_ element: AXUIElement) -> ClickResult {
    // Strategy 1: Try AXPress (preferred)
    let axResult = AXUIElementPerformAction(element, kAXPressAction as CFString)
    if axResult == .success {
        return .axPressSuccess
    }

    // Strategy 2: Try CGEvent at the element's position
    let frame = axFrame(element)
    guard frame != .zero else {
        return .failed("Element has no frame, cannot fall back to CGEvent")
    }

    // Click at the center of the element
    let center = CGPoint(
        x: frame.origin.x + frame.size.width / 2,
        y: frame.origin.y + frame.size.height / 2
    )

    if cgEventClick(at: center) {
        return .cgEventSuccess
    }

    return .failed("Both AXPress and CGEvent click failed")
}

/// Perform a CGEvent mouse click at screen coordinates
func cgEventClick(at point: CGPoint) -> Bool {
    guard let mouseDown = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else { return false }

    guard let mouseUp = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else { return false }

    mouseDown.post(tap: .cghidEventTap)
    usleep(50_000) // 50ms between down and up
    mouseUp.post(tap: .cghidEventTap)

    return true
}

/// Perform a CGEvent double-click
func cgEventDoubleClick(at point: CGPoint) -> Bool {
    guard let mouseDown1 = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else { return false }

    guard let mouseUp1 = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else { return false }

    guard let mouseDown2 = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else { return false }

    guard let mouseUp2 = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else { return false }

    // Set click count for proper double-click detection
    mouseDown1.setIntegerValueField(.mouseEventClickState, value: 1)
    mouseUp1.setIntegerValueField(.mouseEventClickState, value: 1)
    mouseDown2.setIntegerValueField(.mouseEventClickState, value: 2)
    mouseUp2.setIntegerValueField(.mouseEventClickState, value: 2)

    mouseDown1.post(tap: .cghidEventTap)
    usleep(30_000)
    mouseUp1.post(tap: .cghidEventTap)
    usleep(50_000)
    mouseDown2.post(tap: .cghidEventTap)
    usleep(30_000)
    mouseUp2.post(tap: .cghidEventTap)

    return true
}

/// Right-click at coordinates
func cgEventRightClick(at point: CGPoint) -> Bool {
    guard let mouseDown = CGEvent(
        mouseEventSource: nil,
        mouseType: .rightMouseDown,
        mouseCursorPosition: point,
        mouseButton: .right
    ) else { return false }

    guard let mouseUp = CGEvent(
        mouseEventSource: nil,
        mouseType: .rightMouseUp,
        mouseCursorPosition: point,
        mouseButton: .right
    ) else { return false }

    mouseDown.post(tap: .cghidEventTap)
    usleep(50_000)
    mouseUp.post(tap: .cghidEventTap)

    return true
}

/// Move the mouse cursor without clicking (for hover states)
func cgEventMoveMouse(to point: CGPoint) {
    let moveEvent = CGEvent(
        mouseEventSource: nil,
        mouseType: .mouseMoved,
        mouseCursorPosition: point,
        mouseButton: .left
    )
    moveEvent?.post(tap: .cghidEventTap)
}

/// Drag from one point to another
func cgEventDrag(from: CGPoint, to: CGPoint, duration: TimeInterval = 0.5) {
    let steps = max(Int(duration * 60), 10) // ~60fps

    // Mouse down at start
    let mouseDown = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: from,
        mouseButton: .left
    )
    mouseDown?.post(tap: .cghidEventTap)

    // Interpolate movement
    for i in 1...steps {
        let t = CGFloat(i) / CGFloat(steps)
        let x = from.x + (to.x - from.x) * t
        let y = from.y + (to.y - from.y) * t
        let point = CGPoint(x: x, y: y)

        let drag = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseDragged,
            mouseCursorPosition: point,
            mouseButton: .left
        )
        drag?.post(tap: .cghidEventTap)
        usleep(useconds_t(duration / Double(steps) * 1_000_000))
    }

    // Mouse up at end
    let mouseUp = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: to,
        mouseButton: .left
    )
    mouseUp?.post(tap: .cghidEventTap)
}
```

### Complete Hybrid Automation Example

```swift
/// Full production flow: find element via AX, click via best method
func automateButtonClick(
    appBundleID: String,
    buttonTitle: String,
    preferCGEvent: Bool = false
) -> ClickResult {
    guard let appElement = findApp(bundleID: appBundleID) else {
        return .failed("App \(appBundleID) not running")
    }

    // Search all windows for the button
    for window in getWindows(appElement) {
        // Check sheets first (modal dialogs)
        for sheet in findSheets(in: window) {
            if let button = findButton(in: sheet, title: buttonTitle) {
                if preferCGEvent {
                    let frame = axFrame(button)
                    let center = CGPoint(
                        x: frame.midX,
                        y: frame.midY
                    )
                    return cgEventClick(at: center) ? .cgEventSuccess : .failed("CGEvent failed")
                }
                return clickWithFallback(button)
            }
        }

        // Then check the window itself
        if let button = findButton(in: window, title: buttonTitle) {
            if preferCGEvent {
                let frame = axFrame(button)
                let center = CGPoint(x: frame.midX, y: frame.midY)
                return cgEventClick(at: center) ? .cgEventSuccess : .failed("CGEvent failed")
            }
            return clickWithFallback(button)
        }
    }

    return .failed("Button '\(buttonTitle)' not found in \(appBundleID)")
}
```

### AppleScript Fallback

```swift
import Foundation

/// Execute AppleScript as a last resort
func runAppleScript(_ script: String) -> (success: Bool, output: String?) {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    task.arguments = ["-e", script]

    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = pipe

    do {
        try task.run()
        task.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8)
        return (task.terminationStatus == 0, output)
    } catch {
        return (false, error.localizedDescription)
    }
}

/// Click a button via AppleScript (fallback)
func appleScriptClickButton(appName: String, buttonTitle: String, windowIndex: Int = 1) -> Bool {
    let script = """
    tell application "System Events"
        tell process "\(appName)"
            click button "\(buttonTitle)" of window \(windowIndex)
        end tell
    end tell
    """
    return runAppleScript(script).success
}

/// Click a button in a sheet via AppleScript
func appleScriptClickSheetButton(appName: String, buttonTitle: String) -> Bool {
    let script = """
    tell application "System Events"
        tell process "\(appName)"
            click button "\(buttonTitle)" of sheet 1 of window 1
        end tell
    end tell
    """
    return runAppleScript(script).success
}

/// Full fallback chain
func clickWithFullFallback(
    appBundleID: String,
    appName: String,
    buttonTitle: String
) -> ClickResult {
    // 1. Try AXPress via accessibility tree
    guard let appElement = findApp(bundleID: appBundleID) else {
        return .failed("App not running")
    }

    for window in getWindows(appElement) {
        if let button = findButton(in: window, title: buttonTitle) {
            // Try AXPress
            if axPerformAction(button, kAXPressAction) {
                return .axPressSuccess
            }

            // Try CGEvent at AX position
            let frame = axFrame(button)
            if frame != .zero {
                let center = CGPoint(x: frame.midX, y: frame.midY)
                if cgEventClick(at: center) {
                    return .cgEventSuccess
                }
            }
        }
    }

    // 3. Try AppleScript
    if appleScriptClickButton(appName: appName, buttonTitle: buttonTitle) {
        return .appleScriptSuccess
    }

    // 4. Try AppleScript with sheet
    if appleScriptClickSheetButton(appName: appName, buttonTitle: buttonTitle) {
        return .appleScriptSuccess
    }

    return .failed("All click strategies failed for '\(buttonTitle)'")
}
```

---

## 7. Performance Considerations

### Benchmarks (from MacPaw research & Hammerspoon community)

| Operation | Typical Time | Notes |
|-----------|-------------|-------|
| `AXUIElementCopyAttributeValue` (single) | 0.1–1ms | Fast for single attributes |
| Get children of a simple element | 1–5ms | Depends on child count |
| Full tree traversal of TextEdit | ~100ms | Simple app, few elements |
| Full tree traversal of Safari (Google page) | ~15 seconds | Thousands of elements |
| Full tree traversal of Xcode | ~5–10 seconds | Large, complex UI |
| `AXUIElementCopyElementAtPosition` | ~1–2ms | Single point hit test |
| Grid scan (1000x800 area, 20px step) | ~4–8 seconds | ~2000 hit tests |

### Optimization Strategies

```swift
/// 1. BATCH ATTRIBUTE READS — 1 IPC call instead of N
func axBatchAttributes(
    _ element: AXUIElement,
    _ attributes: [String]
) -> [String: Any] {
    var values: CFArray?
    let result = AXUIElementCopyMultipleAttributeValues(
        element,
        attributes as CFArray,
        AXCopyMultipleAttributeOptions(),  // 0 = stop on error
        &values
    )
    guard result == .success, let cfValues = values as? [Any] else {
        return [:]
    }

    var dict: [String: Any] = [:]
    for (i, attr) in attributes.enumerated() where i < cfValues.count {
        let val = cfValues[i]
        // AXValueGetValue errors come back as AXError in the array
        if !(val is AXError) {
            dict[attr] = val
        }
    }
    return dict
}

/// 2. TARGETED SEARCH — don't traverse the whole tree
/// Search only within a known container (sheet, toolbar, etc.)
func findButtonInFocusedWindow(appBundleID: String, title: String) -> AXUIElement? {
    guard let appElement = findApp(bundleID: appBundleID),
          let focusedWindow: AXUIElement = axAttribute(appElement, kAXFocusedWindowAttribute)
    else { return nil }

    // Check sheets first (most common for dialogs)
    for sheet in findSheets(in: focusedWindow) {
        if let button = findButton(in: sheet, title: title) {
            return button
        }
    }

    // Then check window directly
    return findButton(in: focusedWindow, title: title)
}

/// 3. EARLY TERMINATION — stop as soon as you find what you need
/// (Already shown in findFirst() above)

/// 4. CACHING — cache the tree and refresh only on notifications
class CachedTargetMap {
    private var cache: [ClickTarget] = []
    private var lastRefresh: Date = .distantPast
    private let appElement: AXUIElement
    private let maxAge: TimeInterval = 2.0  // Refresh every 2 seconds max

    init(appElement: AXUIElement) {
        self.appElement = appElement
    }

    func getTargets(forceRefresh: Bool = false) -> [ClickTarget] {
        if forceRefresh || Date().timeIntervalSince(lastRefresh) > maxAge {
            refresh()
        }
        return cache
    }

    private func refresh() {
        var targets: [ClickTarget] = []
        for window in getWindows(appElement) {
            enumerateClickTargets(in: window, targets: &targets)
        }
        cache = targets
        lastRefresh = Date()
    }
}

/// 5. PARALLEL WINDOW SCANNING with DispatchGroup
func buildTargetMapParallel(appBundleID: String) -> [ClickTarget] {
    guard let appElement = findApp(bundleID: appBundleID) else {
        return []
    }

    let windows = getWindows(appElement)
    var allTargets: [ClickTarget] = []
    let lock = NSLock()
    let group = DispatchGroup()

    for window in windows {
        group.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            var windowTargets: [ClickTarget] = []
            enumerateClickTargets(in: window, targets: &windowTargets)

            lock.lock()
            allTargets.append(contentsOf: windowTargets)
            lock.unlock()

            group.leave()
        }
    }

    group.wait()
    return allTargets
}
```

### Important: AX Thread Safety

- AXUIElement calls are **synchronous IPC** to the target application
- The target app processes AX requests on its **main thread**
- If the target app's main thread is blocked (e.g., showing an alert), AX calls will hang until timeout
- Always use `AXUIElementSetMessagingTimeout` to prevent indefinite hangs
- Making AX calls from a background thread is fine — the call still goes to the target's main thread

---

## 8. Complete AX Role Reference

All roles defined in `AXRoleConstants.h` (macOS 10.7+):

**Application Structure:**
- `AXApplication`, `AXSystemWide`, `AXWindow`, `AXSheet`, `AXDrawer`, `AXGrowArea`, `AXPopover`

**Buttons & Controls:**
- `AXButton`, `AXRadioButton`, `AXCheckBox`, `AXPopUpButton`, `AXMenuButton`
- `AXDisclosureTriangle`, `AXColorWell`, `AXSlider`, `AXIncrementor`

**Text:**
- `AXTextField`, `AXTextArea`, `AXStaticText`

**Menus:**
- `AXMenuBar`, `AXMenuBarItem`, `AXMenu`, `AXMenuItem`

**Tables & Lists:**
- `AXTable`, `AXColumn`, `AXRow`, `AXOutline`, `AXBrowser`, `AXList`, `AXGrid`, `AXCell`

**Groups & Layout:**
- `AXGroup`, `AXTabGroup`, `AXRadioGroup`, `AXSplitGroup`, `AXSplitter`
- `AXToolbar`, `AXScrollArea`, `AXScrollBar`, `AXLayoutArea`, `AXLayoutItem`

**Indicators:**
- `AXValueIndicator`, `AXBusyIndicator`, `AXProgressIndicator`
- `AXRelevanceIndicator`, `AXLevelIndicator`

**Date/Time:**
- `AXTimeField`, `AXDateField`

**Media & Other:**
- `AXImage`, `AXComboBox`, `AXRuler`, `AXRulerMarker`
- `AXHelpTag`, `AXMatte` (AXMatteRole), `AXDockItem`, `AXHandle`

**Special:**
- `AXUnknown` — element with no defined role

**Subroles (commonly seen):**
- `AXDialog`, `AXSystemDialog`, `AXFloatingWindow`, `AXStandardWindow`
- `AXCloseButton`, `AXMinimizeButton`, `AXZoomButton`, `AXFullScreenButton`
- `AXToolbarButton`, `AXSecureTextField`, `AXSearchField`
- `AXTableRow`, `AXOutlineRow`, `AXSortButton`
- `AXTextLink`, `AXTimeline`

---

## 9. Error Handling Reference

| AXError Code | Name | Meaning | Recovery |
|-------------|------|---------|----------|
| 0 | `.success` | Operation succeeded | — |
| -25200 | `.failure` | Generic failure | Retry once |
| -25201 | `.illegalArgument` | Bad parameter | Fix parameters |
| -25202 | `.invalidUIElement` | Element destroyed | Re-find element |
| -25203 | `.invalidUIElementObserver` | Observer invalid | Recreate observer |
| -25204 | `.cannotComplete` | App busy/messaging failed | Retry with backoff |
| -25205 | `.attributeUnsupported` | Attribute doesn't exist | Check role first |
| -25206 | `.actionUnsupported` | Action not available | Check axActions() |
| -25207 | `.notificationUnsupported` | Notification not supported | Use different notification |
| -25208 | `.notImplemented` | App didn't implement | Try alternative approach |
| -25209 | `.notificationAlreadyRegistered` | Already observing | Safe to ignore |
| -25210 | `.notificationNotRegistered` | Not observing this | Safe to ignore |
| -25211 | `.apiDisabled` | Accessibility not enabled | Prompt user |
| -25212 | `.noValue` | Attribute has no value | Not an error — just nil |
| -25213 | `.parameterizedAttributeUnsupported` | Param attr missing | Check role |
| -25214 | `.notEnoughPrecision` | Float precision loss | Use higher precision |

---

## 10. Libraries & Tools

### Production-Ready Libraries

| Library | Language | Notes | URL |
|---------|----------|-------|-----|
| **AXorcist** | Swift | Modern async/await, fuzzy matching, chainable queries. macOS 14+ | [github.com/steipete/AXorcist](https://github.com/steipete/AXorcist) |
| **AXSwift** | Swift | Clean wrapper, Observer support, role/attribute enums | [github.com/tmandry/AXSwift](https://github.com/tmandry/AXSwift) |
| **Swindler** | Swift | Window management focused, event-driven | [github.com/tmandry/Swindler](https://github.com/tmandry/Swindler) |
| **DFAXUIElement** | Swift | Lightweight, good for simple tasks | [github.com/DevilFinger/DFAXUIElement](https://github.com/DevilFinger/DFAXUIElement) |
| **AccessibilityNavigator** | Swift | Tree navigation focused | [github.com/impel-intelligence/AccessibilityNavigator](https://github.com/impel-intelligence/AccessibilityNavigator) |
| **macapptree** | Swift | MacPaw's UI parser, handles SwiftUI quirks | [github.com/MacPaw/macapptree](https://github.com/MacPaw/macapptree) |
| **Hammerspoon** | Lua | Mature automation tool, wraps AX in Lua | [hammerspoon.org](https://hammerspoon.org) |

### Debugging Tools

- **Accessibility Inspector** (bundled with Xcode): `/Applications/Xcode.app/Contents/Developer/Applications/Accessibility Inspector.app`
- **UI Browser** (commercial): Most comprehensive AX inspector available
- **preflight** tool from AXorcist: CLI for quick AX queries

### Recommendation for Production

For a production automation tool, I recommend:

1. **Use raw AXUIElement C API** (wrapped in your own Swift helpers as shown above) for maximum control and zero dependencies
2. **Reference AXSwift's source** for patterns on Observer setup and attribute handling
3. **Reference AXorcist's source** for patterns on fuzzy matching and batched queries
4. **Build your own ClickTarget map** using the patterns in Section 3
5. **Implement the fallback chain** (AXPress -> CGEvent -> AppleScript) from Section 6

The raw API gives you the best performance and the least surface area for breaking changes from library updates.

---

## Sources

- [Apple: AXUIElement.h Documentation](https://developer.apple.com/documentation/applicationservices/axuielement_h)
- [Apple: Accessibility Programming Guide - The OS X Accessibility Model](https://developer.apple.com/library/archive/documentation/Accessibility/Conceptual/AccessibilityMacOSX/OSXAXmodel.html)
- [Apple: Implementing Accessibility for Custom Controls](https://developer.apple.com/library/archive/documentation/Accessibility/Conceptual/AccessibilityMacOSX/ImplementingAccessibilityforCustomControls.html)
- [Apple: AXObserverAddNotification](https://developer.apple.com/documentation/applicationservices/1462089-axobserveraddnotification)
- [Apple: AXUIElementCopyElementAtPosition](https://developer.apple.com/documentation/applicationservices/1462077-axuielementcopyelementatposition)
- [Apple: AXRoleConstants.h](https://developer.apple.com/documentation/applicationservices/axroleconstants_h)
- [Apple: Logic Pro Accessibility Settings](https://support.apple.com/guide/logicpro/accessibility-settings-lgcpefb6766e/mac)
- [MacPaw: Parsing macOS Application UI](https://research.macpaw.com/publications/how-to-parse-macos-app-ui)
- [AXorcist - Swift AX Wrapper](https://github.com/steipete/AXorcist)
- [AXSwift - Swift Wrapper for Accessibility Clients](https://github.com/tmandry/AXSwift)
- [AXSwift Observer.swift](https://github.com/tmandry/AXSwift/blob/main/Sources/Observer.swift)
- [AXSwift UIElement.swift](https://github.com/tmandry/AXSwift/blob/main/Sources/UIElement.swift)
- [alt-tab-macos AXUIElement Extension](https://github.com/lwouis/alt-tab-macos/blob/master/src/api-wrappers/AXUIElement.swift)
- [DFAXUIElement](https://github.com/DevilFinger/DFAXUIElement)
- [AccessibilityNavigator](https://github.com/impel-intelligence/AccessibilityNavigator)
- [MacPaw macapptree](https://github.com/MacPaw/macapptree)
- [Swindler - macOS Window Management](https://github.com/tmandry/Swindler)
- [AXUIElement in Swift (Gist)](https://gist.github.com/c9iim/4e27150198b7a8703794)
- [CGEvent Mouse Click (Gist)](https://gist.github.com/vorce/04e660526473beecdc3029cf7c5a761c)
- [AXRoleConstants.h (macOS 10.7 SDK)](https://github.com/phracker/MacOSX-SDKs/blob/master/MacOSX10.7.sdk/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/HIServices.framework/Versions/A/Headers/AXRoleConstants.h)
- [Atomic Object: UI Automation with AXSwift](https://spin.atomicobject.com/ui-automation-axswift-ai/)
- [Logic Pro Accessibility Issues](https://chikim.com/logic-accessibility/)
- [Rectangle AccessibilityElement.swift](https://github.com/rxhanson/Rectangle/blob/main/Rectangle/AccessibilityElement.swift)
- [GPII: AXObserverCreate Swift Example](https://ds.gpii.net/content/axobservercreate-notification-example-swift-accessibility-api)
- [SwitchKey: Accessibility Observer Pattern](https://deepwiki.com/itsuhane/SwitchKey/7.3-accessibility-observer-pattern)
- [Hammerspoon axuielement Queries](https://github.com/asmagill/hs._asm.axuielement/blob/master/Queries.md)
