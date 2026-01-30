self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};

  event.waitUntil(
    self.registration.showNotification(data.title || "Notification", {
      body: data.body || "",
      icon: "/favicon.png",
      badge: "/badge.png",
      data: data.data || {},
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.actionUrl;
  if (url) {
    event.waitUntil(clients.openWindow(url));
  }
});
