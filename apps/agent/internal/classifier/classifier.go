// Package classifier provides rule-based categorisation of application activity.
// Rules are evaluated in order; the first matching rule wins.
// Pattern design inspired by ActivityWatch's aw-categorize module.
package classifier

import (
	"regexp"
	"strings"
)

// Category is a dot-delimited path string, e.g. "Work.Development".
type Category = string

// Rule matches an activity event and assigns a category.
type Rule struct {
	// Name is a human-readable label for debugging.
	Name string
	// Fields lists which event fields to check ("app", "title", "url").
	// Empty means check all fields.
	Fields []string
	// Pattern is compiled from Regex.
	Pattern *regexp.Regexp
	// Category is the category to assign on match.
	Category Category
}

// Classify returns the first matching category for the given fields.
// Returns empty string when no rule matches.
func Classify(app, title, url string, rules []Rule) Category {
	for _, r := range rules {
		if r.Pattern == nil {
			continue
		}
		var fields []string
		if len(r.Fields) == 0 {
			fields = []string{app, title, url}
		} else {
			for _, f := range r.Fields {
				switch strings.ToLower(f) {
				case "app":
					fields = append(fields, app)
				case "title":
					fields = append(fields, title)
				case "url":
					fields = append(fields, url)
				}
			}
		}
		for _, val := range fields {
			if val != "" && r.Pattern.MatchString(val) {
				return r.Category
			}
		}
	}
	return "Uncategorized"
}

// MustCompile builds a Rule and panics on bad regex (for use in init vars).
func MustCompile(name string, fields []string, pattern string, category Category) Rule {
	return Rule{
		Name:     name,
		Fields:   fields,
		Pattern:  regexp.MustCompile(pattern),
		Category: category,
	}
}

// DefaultRules is the built-in classification ruleset.
// Rules are evaluated top-to-bottom; first match wins.
var DefaultRules = []Rule{
	// ── Development ──────────────────────────────────────────────────────────
	MustCompile("IDEs", []string{"app"}, `(?i)^(code|vscode|cursor|sublime[\s_]text|atom|vim|neovim|nvim|idea|pycharm|webstorm|clion|datagrip|rider|goland|rubymine|android[\s_]studio|xcode|eclipse|netbeans|notepad\+\+|emacs|helix)`, "Work.Development"),
	MustCompile("Terminals", []string{"app"}, `(?i)^(terminal|iterm|iterm2|wt|windows[\s_]terminal|cmd|powershell|pwsh|bash|zsh|hyper|alacritty|kitty|wezterm|tmux|screen|konsole|gnome[\s_]terminal|xterm|fish)`, "Work.Development"),
	MustCompile("Version Control", []string{"app", "title"}, `(?i)(github\.com|gitlab\.com|bitbucket\.org|git\s|sourcetree|fork\.app|gitk|gitkraken)`, "Work.Development"),
	MustCompile("Build Tools", []string{"app"}, `(?i)^(docker|docker[\s_]desktop|gradle|maven|make|cmake|bazel|ninja|cargo|npm|yarn|pnpm|webpack|vite|esbuild)`, "Work.Development"),
	MustCompile("API Tools", []string{"app"}, `(?i)^(postman|insomnia|httpie|paw|rapidapi|thunder[\s_]client)`, "Work.Development"),
	MustCompile("Databases", []string{"app"}, `(?i)^(tableplus|datagrip|dbeaver|mysql[\s_]workbench|pgadmin|robo[\s_]3t|studio[\s_]3t|sequel[\s_]pro|sequel[\s_]ace|beekeeper[\s_]studio|mongodb[\s_]compass)`, "Work.Development"),

	// ── Communication ────────────────────────────────────────────────────────
	MustCompile("Slack", []string{"app"}, `(?i)^slack$`, "Work.Communication"),
	MustCompile("Teams", []string{"app"}, `(?i)^(microsoft[\s_]teams|teams)`, "Work.Communication"),
	MustCompile("Zoom", []string{"app"}, `(?i)^zoom`, "Work.Communication"),
	MustCompile("Discord", []string{"app"}, `(?i)^discord`, "Work.Communication"),
	MustCompile("Email Clients", []string{"app"}, `(?i)^(mail|outlook|thunderbird|spark|airmail|mimestream|apple[\s_]mail|evolution|mutt|neomutt)`, "Work.Communication"),
	MustCompile("Email Web", []string{"url"}, `(?i)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|app\.fastmail\.com|mail\.yahoo\.com)`, "Work.Communication"),
	MustCompile("Video Calls", []string{"app", "title"}, `(?i)(webex|bluejeans|google[\s_]meet|meet\.google\.com|gotomeeting|ringcentral)`, "Work.Communication"),

	// ── Productivity / Office ─────────────────────────────────────────────────
	MustCompile("Office Apps", []string{"app"}, `(?i)^(microsoft[\s_]word|word|microsoft[\s_]excel|excel|microsoft[\s_]powerpoint|powerpoint|pages|numbers|keynote|libreoffice|openoffice|wps[\s_]office|wordpad)`, "Work.Productivity"),
	MustCompile("Notion / Docs", []string{"app", "url"}, `(?i)(notion|coda|obsidian|roam|logseq|notion\.so|coda\.io|docs\.google\.com|sheets\.google\.com|slides\.google\.com|drive\.google\.com)`, "Work.Productivity"),
	MustCompile("Task Managers", []string{"app", "url"}, `(?i)(todoist|things3|ticktick|linear|jira|asana|trello|basecamp|monday\.com|clickup|height\.app|plane\.so|shortcut\.com)`, "Work.Productivity"),
	MustCompile("Calendar", []string{"app", "url"}, `(?i)^(calendar|fantastical|busycal|calendar\.google\.com|outlook\.com/calendar)`, "Work.Productivity"),
	MustCompile("Figma / Design", []string{"app", "url"}, `(?i)(figma|sketch|adobe[\s_]xd|zeplin|invision|framer|canva|miro\.com|figma\.com)`, "Work.Design"),

	// ── Reference / Research ─────────────────────────────────────────────────
	MustCompile("GitHub", []string{"url"}, `(?i)github\.com`, "Work.Development"),
	MustCompile("Stack Overflow", []string{"url"}, `(?i)stackoverflow\.com`, "Work.Development"),
	MustCompile("MDN / Docs", []string{"url"}, `(?i)(developer\.mozilla\.org|docs\.python\.org|pkg\.go\.dev|docs\.rs|cppreference\.com|devdocs\.io)`, "Work.Development"),
	MustCompile("AWS Console", []string{"url"}, `(?i)(console\.aws\.amazon\.com|console\.cloud\.google\.com|portal\.azure\.com)`, "Work.Development"),
	MustCompile("Wikipedia", []string{"url"}, `(?i)wikipedia\.org`, "Reference"),

	// ── Entertainment ─────────────────────────────────────────────────────────
	MustCompile("YouTube", []string{"url"}, `(?i)youtube\.com`, "Leisure.Video"),
	MustCompile("Netflix", []string{"url", "app"}, `(?i)(netflix\.com|netflix)`, "Leisure.Video"),
	MustCompile("Twitch", []string{"url", "app"}, `(?i)(twitch\.tv|twitch)`, "Leisure.Video"),
	MustCompile("Disney+", []string{"url"}, `(?i)disneyplus\.com`, "Leisure.Video"),
	MustCompile("Prime Video", []string{"url"}, `(?i)primevideo\.com|amazon\.com/video`, "Leisure.Video"),
	MustCompile("Spotify", []string{"app", "url"}, `(?i)(spotify)`, "Leisure.Music"),
	MustCompile("Apple Music", []string{"app"}, `(?i)^(music|apple[\s_]music|itunes)$`, "Leisure.Music"),
	MustCompile("Gaming", []string{"app", "title"}, `(?i)(steam|battle\.net|epic[\s_]games|origin|gog[\s_]galaxy|xbox|playstation|lutris)`, "Leisure.Gaming"),
	MustCompile("Reddit", []string{"url"}, `(?i)reddit\.com`, "Leisure.Social"),
	MustCompile("Twitter/X", []string{"url"}, `(?i)(twitter\.com|x\.com)`, "Leisure.Social"),
	MustCompile("Facebook", []string{"url"}, `(?i)facebook\.com`, "Leisure.Social"),
	MustCompile("Instagram", []string{"url"}, `(?i)instagram\.com`, "Leisure.Social"),
	MustCompile("TikTok", []string{"url"}, `(?i)tiktok\.com`, "Leisure.Social"),
	MustCompile("Hacker News", []string{"url"}, `(?i)news\.ycombinator\.com`, "Leisure.Social"),

	// ── System / OS ──────────────────────────────────────────────────────────
	MustCompile("System Settings", []string{"app"}, `(?i)^(system[\s_]preferences|system[\s_]settings|control[\s_]panel|settings\.exe|regedit)`, "System"),
	MustCompile("File Manager", []string{"app"}, `(?i)^(finder|explorer\.exe|nautilus|thunar|dolphin|nemo|ranger)$`, "System"),

	// ── Meetings / Presentation ──────────────────────────────────────────────
	MustCompile("Active Zoom Meeting", []string{"title"}, `(?i)(zoom meeting|zoom webinar)`, "Work.Meeting"),
	MustCompile("Active Teams Call", []string{"title"}, `(?i)(microsoft teams call|teams meeting)`, "Work.Meeting"),
}
