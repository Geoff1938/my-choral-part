# MyChoralPart.com - Branding & Design System

## Overview
This folder contains all branding assets and design specifications for the MyChoralPart MIDI player application. Use this guide to maintain consistent visual design throughout the app.

---

## Logo Files

### SVG Files (Scalable - Use These When Possible)
- `logo-main.svg` - Full logo with icon and "mychoralpart" text (220×220px)
- `logo-icon-only.svg` - Icon only, no text (180×180px) - **Use for favicons and app icons**
- `logo-horizontal.svg` - Horizontal layout with tagline (320×160px) - **Use for headers**

### PNG Files (Raster - Pre-rendered at specific sizes)

#### Icon Sizes (icon-only versions)
- `logo-icon-16.png` - Favicon size
- `logo-icon-32.png` - Standard favicon
- `logo-icon-64.png` - Touch icon (mobile)
- `logo-icon-128.png` - Small app icon
- `logo-icon-256.png` - Standard app icon
- `logo-icon-512.png` - Large app icon
- `logo-icon-1024.png` - High-resolution for stores

#### Full Logo Sizes
- `logo-main-256.png` - Small with text
- `logo-main-512.png` - Medium with text
- `logo-main-1024.png` - Large with text

#### Horizontal Layout
- `logo-horizontal-640.png` - Standard header size
- `logo-horizontal-960.png` - Large header size

### Usage Recommendations

**For website/app:**
- Use SVG files wherever possible (they scale perfectly)
- Favicon: Use `logo-icon-32.png` in HTML `<link>` tag
- Touch icon (iOS): Use `logo-icon-180.png` or `logo-icon-256.png`
- Header logo: Use `logo-horizontal.svg`
- Loading screen: Use `logo-main.svg`

**For social media:**
- Profile picture: `logo-icon-512.png`
- Cover/banner: `logo-horizontal-960.png`

---

## Color Palette

### Primary Colors (Voice Parts)

#### Soprano (Red)
- **Hex:** `#E74C3C`
- **RGB:** `rgb(231, 76, 60)`
- **Usage:** Soprano voice part indicators, buttons, highlights

#### Alto (Blue)
- **Hex:** `#3498DB`
- **RGB:** `rgb(52, 152, 219)`
- **Usage:** Alto voice part indicators, secondary buttons

#### Tenor (Green)
- **Hex:** `#2ECC71`
- **RGB:** `rgb(46, 204, 113)`
- **Usage:** Tenor voice part indicators, success states

#### Bass (Purple)
- **Hex:** `#9B59B6`
- **RGB:** `rgb(155, 89, 182)`
- **Usage:** Bass voice part indicators

### Secondary Colors

#### Highlight/Active
- **Hex:** `#F39C12` (Orange/Gold)
- **RGB:** `rgb(243, 156, 18)`
- **Usage:** Active voice part, currently playing indicator, hover states

#### Dark Text/UI
- **Hex:** `#2C3E50`
- **RGB:** `rgb(44, 62, 80)`
- **Usage:** Primary text, icons, main UI elements

#### Medium Gray
- **Hex:** `#7F8C8D`
- **RGB:** `rgb(127, 140, 141)`
- **Usage:** Secondary text, disabled states, subtitles

#### Light Gray
- **Hex:** `#95A5A6`
- **RGB:** `rgb(149, 165, 166)`
- **Usage:** Borders, dividers, placeholders

#### Background Gray
- **Hex:** `#E8E8E8`
- **RGB:** `rgb(232, 232, 232)`
- **Usage:** Background shades, card borders

#### White
- **Hex:** `#FFFFFF`
- **RGB:** `rgb(255, 255, 255)`
- **Usage:** Backgrounds, text on colored buttons

### Color Usage Guidelines

1. **Voice Part Selection:**
   - Use the respective voice color (S/A/T/B) at full opacity
   - Selected/active part: Use the highlight color (#F39C12)
   - Unselected parts: Reduce opacity to 0.5

2. **Buttons:**
   - Primary action: Use voice part color or #3498DB (Alto blue)
   - Secondary action: Use #95A5A6 (light gray)
   - Danger/Stop: Use #E74C3C (Soprano red)
   - Success/Play: Use #2ECC71 (Tenor green)

3. **Text:**
   - Headlines/Primary: #2C3E50 (dark)
   - Body text: #2C3E50 with slight transparency (0.87 opacity)
   - Secondary text: #7F8C8D
   - Disabled text: #95A5A6

---

## Typography

### Recommended Font Stack

#### Primary Font (UI & Body Text)
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", 
             "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", 
             "Helvetica Neue", Arial, sans-serif;
```

**Why:** System fonts provide the best performance and feel native on each platform.

#### Alternative: Google Fonts
If you prefer a specific web font:
```css
/* Import in HTML head or CSS */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```

**Inter** is clean, modern, and highly readable - perfect for a music application.

### Font Sizes

```css
/* Headings */
--font-size-h1: 32px;      /* Main page titles */
--font-size-h2: 24px;      /* Section headers */
--font-size-h3: 20px;      /* Card titles */
--font-size-h4: 18px;      /* Sub-sections */

/* Body Text */
--font-size-base: 16px;    /* Regular body text */
--font-size-small: 14px;   /* Secondary info */
--font-size-tiny: 12px;    /* Captions, labels */

/* Special */
--font-size-large: 18px;   /* Prominent buttons */
--font-size-xlarge: 20px;  /* Hero text */
```

### Font Weights

```css
--font-weight-normal: 400;   /* Regular text */
--font-weight-medium: 500;   /* Slightly emphasized */
--font-weight-semibold: 600; /* Buttons, labels */
--font-weight-bold: 700;     /* Headings, important */
```

### Line Heights

```css
--line-height-tight: 1.2;   /* Headings */
--line-height-normal: 1.5;  /* Body text */
--line-height-relaxed: 1.7; /* Long-form content */
```

---

## Spacing System

Use a consistent spacing scale based on 4px increments:

```css
--space-xs: 4px;
--space-sm: 8px;
--space-md: 16px;
--space-lg: 24px;
--space-xl: 32px;
--space-2xl: 48px;
--space-3xl: 64px;
```

**Usage:**
- Padding inside buttons: `--space-sm` to `--space-md`
- Margin between elements: `--space-md`
- Section spacing: `--space-xl` to `--space-2xl`
- Card padding: `--space-lg`

---

## Component Styles

### Buttons

#### Primary Button (e.g., Play)
```css
.btn-primary {
    background-color: #2ECC71; /* Tenor green */
    color: white;
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
}

.btn-primary:hover {
    background-color: #27AE60; /* Slightly darker */
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(46, 204, 113, 0.3);
}

.btn-primary:active {
    transform: translateY(0);
}
```

#### Secondary Button
```css
.btn-secondary {
    background-color: transparent;
    color: #2C3E50;
    padding: 12px 24px;
    border: 2px solid #E8E8E8;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
}

.btn-secondary:hover {
    border-color: #3498DB;
    color: #3498DB;
    background-color: rgba(52, 152, 219, 0.05);
}
```

#### Voice Part Button (toggleable)
```css
.btn-voice-part {
    padding: 10px 20px;
    border: 2px solid transparent;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s ease;
    opacity: 0.6;
}

.btn-voice-part.soprano { background-color: #E74C3C; color: white; }
.btn-voice-part.alto { background-color: #3498DB; color: white; }
.btn-voice-part.tenor { background-color: #2ECC71; color: white; }
.btn-voice-part.bass { background-color: #9B59B6; color: white; }

.btn-voice-part.active {
    opacity: 1;
    border-color: #F39C12;
    box-shadow: 0 0 0 3px rgba(243, 156, 18, 0.2);
}

.btn-voice-part:hover {
    opacity: 1;
    transform: translateY(-2px);
}
```

### Cards

```css
.card {
    background: white;
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transition: box-shadow 0.2s ease;
}

.card:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.card-title {
    font-size: 20px;
    font-weight: 600;
    color: #2C3E50;
    margin-bottom: 12px;
}

.card-text {
    font-size: 16px;
    color: #2C3E50;
    opacity: 0.87;
    line-height: 1.5;
}
```

### Progress Bar

```css
.progress-bar {
    width: 100%;
    height: 8px;
    background-color: #E8E8E8;
    border-radius: 4px;
    overflow: hidden;
}

.progress-bar-fill {
    height: 100%;
    background-color: #3498DB; /* Use voice part color when applicable */
    border-radius: 4px;
    transition: width 0.3s ease;
}
```

### Volume/Range Slider

```css
.slider {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(to right, 
        #E8E8E8 0%, 
        #3498DB var(--value), 
        #E8E8E8 var(--value));
    outline: none;
    cursor: pointer;
}

.slider::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #3498DB;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: all 0.2s ease;
}

.slider::-webkit-slider-thumb:hover {
    background: #2980B9;
    transform: scale(1.1);
}
```

---

## Layout Recommendations

### App Structure

```
┌─────────────────────────────────────┐
│ Header (logo-horizontal.svg)       │
│ [Logo] MyChoralPart                │
├─────────────────────────────────────┤
│                                     │
│  Main Content Area                  │
│  ┌─────────────────────────────┐  │
│  │ MIDI Player Controls         │  │
│  │ [S] [A] [T] [B] buttons     │  │
│  │ ▶ ⏸ ⏹ ⏪ ⏩                 │  │
│  │ ━━━━━━━●━━━ Progress       │  │
│  └─────────────────────────────┘  │
│                                     │
│  ┌─────────────────────────────┐  │
│  │ Song List / File Upload      │  │
│  └─────────────────────────────┘  │
│                                     │
└─────────────────────────────────────┘
```

### Responsive Breakpoints

```css
/* Mobile first approach */
--breakpoint-sm: 640px;   /* Small tablets */
--breakpoint-md: 768px;   /* Tablets */
--breakpoint-lg: 1024px;  /* Desktops */
--breakpoint-xl: 1280px;  /* Large desktops */
```

### Container Widths

```css
.container {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 16px;
}

@media (min-width: 768px) {
    .container {
        padding: 0 24px;
    }
}
```

---

## UI States

### Loading State
```css
.loading {
    opacity: 0.6;
    pointer-events: none;
    cursor: wait;
}

/* Skeleton loader */
.skeleton {
    background: linear-gradient(
        90deg,
        #E8E8E8 25%,
        #F5F5F5 50%,
        #E8E8E8 75%
    );
    background-size: 200% 100%;
    animation: loading 1.5s infinite;
}

@keyframes loading {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
```

### Disabled State
```css
.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
}
```

### Focus States (Accessibility)
```css
*:focus {
    outline: 2px solid #3498DB;
    outline-offset: 2px;
}

button:focus,
input:focus,
select:focus {
    outline: 2px solid #3498DB;
    outline-offset: 2px;
}
```

---

## Icons & Musical Symbols

### Recommended Icon Libraries

**For general UI icons:**
- [Lucide Icons](https://lucide.dev/) - Clean, consistent, open-source
- [Heroicons](https://heroicons.com/) - Beautiful, MIT licensed
- [Feather Icons](https://feathericons.com/) - Minimal, simple

**For musical symbols:**
- Use Unicode musical symbols where possible:
  - ♩ Quarter note: `&#9833;` or `\u2669`
  - ♪ Eighth note: `&#9834;` or `\u266A`
  - ♫ Beamed eighth notes: `&#9835;` or `\u266B`
  - ♬ Beamed sixteenth notes: `&#9836;` or `\u266C`
  - ♭ Flat: `&#9837;` or `\u266D`
  - ♮ Natural: `&#9838;` or `\u266E`
  - ♯ Sharp: `&#9839;` or `\u266F`

### Icon Sizes
```css
--icon-size-sm: 16px;
--icon-size-md: 24px;
--icon-size-lg: 32px;
--icon-size-xl: 48px;
```

---

## Animation Guidelines

### Timing Functions
```css
--ease-out: cubic-bezier(0.33, 1, 0.68, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
```

### Duration
```css
--duration-fast: 150ms;    /* Hover states */
--duration-normal: 250ms;  /* Most transitions */
--duration-slow: 400ms;    /* Complex animations */
```

### Example Transitions
```css
/* Smooth hover */
.interactive {
    transition: all var(--duration-fast) var(--ease-out);
}

/* Modal/overlay entrance */
.modal {
    animation: fadeIn var(--duration-normal) var(--ease-in-out);
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}
```

---

## Accessibility

### Color Contrast
All text meets WCAG AA standards:
- Normal text: 4.5:1 minimum contrast ratio
- Large text (18px+): 3:1 minimum contrast ratio

### Focus Management
- Always provide visible focus indicators
- Maintain logical tab order
- Use `aria-label` for icon-only buttons

### Screen Reader Labels
```html
<!-- Example: Voice part button -->
<button class="btn-voice-part soprano" aria-label="Toggle Soprano part">
    S
</button>

<!-- Example: Play button -->
<button class="btn-play" aria-label="Play MIDI file">
    ▶
</button>
```

---

## Quick Start Checklist for Claude Code

When Claude Code works on the MyChoralPart app, use this checklist:

- [ ] Import/reference the appropriate logo file from this folder
- [ ] Use the color palette variables (consider creating CSS custom properties)
- [ ] Apply the recommended font stack
- [ ] Follow the spacing system (4px increments)
- [ ] Use the component styles for buttons, cards, etc.
- [ ] Implement proper focus states for accessibility
- [ ] Use voice part colors consistently (S/A/T/B)
- [ ] Add smooth transitions to interactive elements
- [ ] Ensure color contrast meets WCAG standards
- [ ] Test responsive behavior at all breakpoints

---

## CSS Variables (Copy-Paste Ready)

```css
:root {
    /* Colors - Voice Parts */
    --color-soprano: #E74C3C;
    --color-alto: #3498DB;
    --color-tenor: #2ECC71;
    --color-bass: #9B59B6;
    
    /* Colors - UI */
    --color-highlight: #F39C12;
    --color-text-dark: #2C3E50;
    --color-text-medium: #7F8C8D;
    --color-text-light: #95A5A6;
    --color-border: #E8E8E8;
    --color-background: #FFFFFF;
    
    /* Typography */
    --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif;
    --font-size-h1: 32px;
    --font-size-h2: 24px;
    --font-size-h3: 20px;
    --font-size-base: 16px;
    --font-size-small: 14px;
    --font-size-tiny: 12px;
    
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;
    
    --line-height-tight: 1.2;
    --line-height-normal: 1.5;
    --line-height-relaxed: 1.7;
    
    /* Spacing */
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 16px;
    --space-lg: 24px;
    --space-xl: 32px;
    --space-2xl: 48px;
    
    /* Border Radius */
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-xl: 16px;
    
    /* Shadows */
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1);
    --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.1);
    --shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.15);
    
    /* Transitions */
    --duration-fast: 150ms;
    --duration-normal: 250ms;
    --duration-slow: 400ms;
    
    --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
    --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}
```

---

## File Structure Summary

```
mychoralpart-branding/
├── BRANDING_GUIDE.md          (this file)
│
├── logo-main.svg              (full logo with text)
├── logo-icon-only.svg         (icon only)
├── logo-horizontal.svg        (horizontal layout)
│
├── logo-icon-16.png           (favicon 16px)
├── logo-icon-32.png           (favicon 32px)
├── logo-icon-64.png           (touch icon 64px)
├── logo-icon-128.png          (app icon 128px)
├── logo-icon-256.png          (app icon 256px)
├── logo-icon-512.png          (app icon 512px)
├── logo-icon-1024.png         (high-res 1024px)
│
├── logo-main-256.png          (logo with text 256px)
├── logo-main-512.png          (logo with text 512px)
├── logo-main-1024.png         (logo with text 1024px)
│
├── logo-horizontal-640.png    (header 640px)
└── logo-horizontal-960.png    (header 960px)
```

---

## Questions or Modifications?

If Claude Code or developers need clarification on any design decisions or want to propose changes, refer back to this guide. The key principles are:

1. **Consistency** - Use the established color palette and spacing
2. **Clarity** - Make voice parts immediately identifiable
3. **Accessibility** - Ensure good contrast and keyboard navigation
4. **Simplicity** - Keep the UI clean and focused on music practice

Good luck building MyChoralPart! 🎵
