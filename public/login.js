(function () {
  // Get OAuth parameters from URL query string
  const urlParams = new URLSearchParams(window.location.search);
  const clientId = urlParams.get("client_id");
  const redirectUri = urlParams.get("redirect_uri");
  const state = urlParams.get("state") || "";

  const form = document.getElementById("loginForm");
  const submitBtn = document.getElementById("submitBtn");
  const errorDiv = document.getElementById("error");

  form.addEventListener("submit", async e => {
    e.preventDefault();

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";
    errorDiv.style.display = "none";

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {
      const response = await fetch("/oauth/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
          client_id: clientId,
          redirect_uri: redirectUri,
          state: state,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Redirect to callback URL
        window.location.href = data.redirect_uri;
      } else {
        errorDiv.textContent =
          data.error_description || "Authentication failed";
        errorDiv.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In";
      }
    } catch (error) {
      errorDiv.textContent = "Network error. Please try again.";
      errorDiv.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In";
    }
  });
})();
