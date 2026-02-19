/**
 * Theme management - supports light/dark toggle with system preference
 */

function updateThemeDisplay(theme) {
  const display = document.getElementById("current-theme");
  const toggleLink = document.getElementById("theme-toggle");

  if (display) display.textContent = theme;

  if (toggleLink) {
    // Update link to show opposite theme (what it will switch TO)
    const targetTheme = theme === "light" ? "dark" : "light";
    const text = targetTheme === "dark" ? "Dark" : "Light";
    const iconSrc = targetTheme === "dark" ? "/images/icons/moon.svg" : "/images/icons/sun.svg";
    
    const icon = toggleLink.querySelector(".theme-icon");
    const textSpan = toggleLink.querySelector(".theme-text");
    
    if (icon) icon.src = iconSrc;
    if (textSpan) textSpan.textContent = `${text} theme`;
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = savedTheme || (prefersDark ? "dark" : "light");

  document.documentElement.setAttribute("theme", theme);
  updateThemeDisplay(theme);
}

function toggleTheme(e) {
  if (e) e.preventDefault();

  const html = document.documentElement;
  const currentTheme = html.getAttribute("theme");
  const newTheme = currentTheme === "light" ? "dark" : "light";

  html.setAttribute("theme", newTheme);
  localStorage.setItem("theme", newTheme);
  updateThemeDisplay(newTheme);
}

initTheme();

document.addEventListener("DOMContentLoaded", function () {
  const toggleLink = document.getElementById("theme-toggle");
  if (toggleLink) {
    toggleLink.addEventListener("click", toggleTheme);
  }
});
