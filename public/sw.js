// Service Worker for Web Push Notifications

self.addEventListener('push', function(event) {
    console.log('[ServiceWorker] Push event received');
    console.log('[ServiceWorker] Event data:', event.data);
    
    let notificationData;
    
    if (event.data) {
        try {
            notificationData = event.data.json();
            console.log('[ServiceWorker] Parsed notification data:', notificationData);
        } catch (e) {
            console.error('[ServiceWorker] Failed to parse notification data:', e);
            // テキストデータの場合
            notificationData = {
                title: 'さくっとタスク',
                body: event.data.text() || 'タスクの通知が届きました',
            };
        }
    } else {
        console.log('[ServiceWorker] No event data, using default notification');
        notificationData = {
            title: 'さくっとタスク',
            body: 'タスクの通知が届きました',
        };
    }
    
    const options = {
        body: notificationData.body || 'タスクの通知が届きました',
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: notificationData.tag || 'task-notification',
        requireInteraction: false,
        data: notificationData.data || {},
    };

    console.log('[ServiceWorker] Showing notification with options:', options);
    
    event.waitUntil(
        self.registration.showNotification(notificationData.title || 'さくっとタスク', options)
            .then(() => {
                console.log('[ServiceWorker] Notification shown successfully');
            })
            .catch((error) => {
                console.error('[ServiceWorker] Failed to show notification:', error);
            })
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    const urlToOpen = event.notification.data.url || '/top';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function(clientList) {
                // 既に開いているウィンドウがあればそこを開く
                for (let i = 0; i < clientList.length; i++) {
                    const client = clientList[i];
                    if (client.url === urlToOpen && 'focus' in client) {
                        return client.focus();
                    }
                }
                // 新しいウィンドウを開く
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});
