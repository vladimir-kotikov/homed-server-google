/**
 * Dashboard page functionality
 */

/**
 * Copy client token to clipboard
 */
async function copyToken(event) {
  if (event) {
    event.preventDefault();
  }

  const tokenValue = document.querySelector(".token-value")?.textContent;
  const btn = document.querySelector(".copy-link");

  if (!tokenValue || !btn) return;

  try {
    await navigator.clipboard.writeText(tokenValue);

    const icon = btn.querySelector(".copy-icon");
    const textSpan = btn.querySelector(".copy-text");

    if (icon) icon.src = "/images/icons/check.svg";
    if (textSpan) textSpan.textContent = "Copied";
    btn.classList.add("copied");

    setTimeout(() => {
      if (icon) icon.src = "/images/icons/clipboard.svg";
      if (textSpan) textSpan.textContent = "Copy";
      btn.classList.remove("copied");
    }, 2000);
  } catch (error) {
    // Silently handle clipboard errors
  }
}

// Attach event listener when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  const copyBtn = document.querySelector(".copy-link");
  if (copyBtn) {
    copyBtn.addEventListener("click", copyToken);
  }
});

export { copyToken };
