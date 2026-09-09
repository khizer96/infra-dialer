/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#F5F7FA',
    tint: '#55D6BE',

    // Core surfaces
    background: '#0B1118',
    foreground: '#F5F7FA',

    // Cards / elevated surfaces
    card: '#121D27',
    cardForeground: '#F5F7FA',

    // Primary action color (buttons, links, active states)
    primary: '#55D6BE',
    primaryForeground: '#07120F',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#1B2935',
    secondaryForeground: '#DCE7ED',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#17232D',
    mutedForeground: '#90A4B2',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#123C3D',
    accentForeground: '#9EF0D9',

    // Destructive actions (delete, error states)
    destructive: '#F26B5E',
    destructiveForeground: '#FFFFFF',

    // Borders and input outlines
    border: '#243541',
    input: '#304552',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
