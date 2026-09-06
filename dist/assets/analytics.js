// Google Analytics 4
// Paste the Measurement ID for Sirius Entertainment between the quotes below.
// It starts with "G-" and is found in Analytics > Admin > Data streams > Web.
const GA_MEASUREMENT_ID = "";

(() => {
  const measurementId = GA_MEASUREMENT_ID.trim();
  if (!/^G-[A-Z0-9]+$/i.test(measurementId)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  const googleTag = document.createElement("script");
  googleTag.async = true;
  googleTag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(googleTag);

  window.gtag("js", new Date());
  window.gtag("config", measurementId);
})();

