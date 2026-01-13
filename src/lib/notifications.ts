import { Resend } from 'resend';
import webpush from 'web-push';
import { sql } from './db';
import { format, isSameDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { shouldIncludeRecurringTask } from './tasks';

// Resendクライアントの初期化
const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

// Web PushのVAPIDキー設定
const vapidPublicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '';

if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(
        'mailto:chiteijin315@gmail.com', // 管理者のメールアドレス
        vapidPublicKey,
        vapidPrivateKey
    );
}

// 通知送信が必要なタスクを取得
export async function getTasksToNotify(
    targetDate: Date,
    targetTime: string // HH:mm形式
): Promise<
    Array<{
        taskId: string;
        userId: string;
        title: string;
        dueDate: Date;
        notificationTime: string;
    }>
> {
    console.log(`[Notification] Getting tasks to notify for date ${targetDate.toISOString().split('T')[0]} at time ${targetTime}`);
    
    // 指定時刻に通知が必要なタスクをすべて取得
    const tasks = await sql`
        SELECT 
            t.id as task_id,
            t.user_id,
            t.title,
            t.due_date,
            t.notification_time,
            tr.type as recurrence_type,
            tr.custom_days,
            tr.custom_unit,
            tr.weekdays as recurrence_weekdays
        FROM tasks t
        LEFT JOIN task_recurrences tr ON t.id = tr.task_id
        WHERE 
            t.notification_enabled = true
            AND t.notification_time = ${targetTime}
    `;

    console.log(`[Notification] Found ${tasks.length} task(s) with notification_enabled=true and notification_time=${targetTime}`);

    const result: Array<{
        taskId: string;
        userId: string;
        title: string;
        dueDate: Date;
        notificationTime: string;
    }> = [];

    // tasks.tsと同じロジックで、指定日に該当するタスクをフィルタリング
    for (const task of tasks) {
        const taskDueDate = new Date(task.due_date);
        taskDueDate.setHours(0, 0, 0, 0);
        const targetDateNormalized = new Date(targetDate);
        targetDateNormalized.setHours(0, 0, 0, 0);

        // 単発タスク（繰り返しなし）
        if (!task.recurrence_type) {
            if (isSameDay(taskDueDate, targetDate)) {
                console.log(`[Notification] Including single task ${task.task_id}: "${task.title}" on ${taskDueDate.toISOString().split('T')[0]}`);
                result.push({
                    taskId: task.task_id,
                    userId: task.user_id,
                    title: task.title,
                    dueDate: taskDueDate,
                    notificationTime: task.notification_time,
                });
            } else {
                console.log(`[Notification] Excluding single task ${task.task_id}: due_date=${taskDueDate.toISOString().split('T')[0]} doesn't match target=${targetDateNormalized.toISOString().split('T')[0]}`);
            }
        } else {
            // 繰り返しタスク: shouldIncludeRecurringTaskを使用
            const shouldInclude = await shouldIncludeRecurringTask(
                task.task_id,
                task.recurrence_type,
                taskDueDate,
                targetDate,
                task.custom_days || null,
                task.custom_unit || null,
                task.recurrence_weekdays || null
            );

            if (shouldInclude) {
                console.log(`[Notification] Including recurring task ${task.task_id}: "${task.title}" (type=${task.recurrence_type})`);
                result.push({
                    taskId: task.task_id,
                    userId: task.user_id,
                    title: task.title,
                    dueDate: taskDueDate,
                    notificationTime: task.notification_time,
                });
            } else {
                console.log(`[Notification] Excluding recurring task ${task.task_id}: "${task.title}" (type=${task.recurrence_type}) - doesn't match target date`);
            }
        }
    }

    console.log(`[Notification] Filtered to ${result.length} task(s) matching target date`);
    return result;
}

// メール通知を送信
export async function sendEmailNotification(
    email: string,
    taskTitle: string,
    dueDate: Date,
    notificationTime: string
): Promise<{ success: boolean; error?: string }> {
    if (!resend) {
        const errorMsg = 'Resend API key is not configured';
        console.error(errorMsg);
        return { success: false, error: errorMsg };
    }

    try {
        const formattedDate = format(dueDate, 'yyyy年M月d日(E)', { locale: ja });
        const subject = `【さくっとタスク】${taskTitle} の通知`;
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">タスクの通知</h2>
                <p>以下のタスクの期日・通知時刻になりました。</p>
                <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">${taskTitle}</h3>
                    <p><strong>期日:</strong> ${formattedDate}</p>
                    <p><strong>通知時刻:</strong> ${notificationTime}</p>
                </div>
                <p style="color: #666; font-size: 14px;">
                    このメールは、さくっとタスクの通知設定により自動送信されました。
                </p>
            </div>
        `;

        // 送信元メールアドレス（Resendの設定に応じて変更）
        // 無料プラン: onboarding@resend.dev を使用（自分のメールアドレスにしか送信不可）
        // 独自ドメイン設定後: your-domain.com のメールアドレスを使用
        const fromAddress = process.env.RESEND_FROM_EMAIL || 'Sakutto Task <onboarding@resend.dev>';
        console.log(`[Email] Attempting to send email to: ${email}`);
        console.log(`[Email] From: ${fromAddress}`);
        
        const result = await resend.emails.send({
            from: fromAddress,
            to: email,
            subject: subject,
            html: htmlContent,
        });

        if (result.error) {
            const errorMsg = `Resend API error: ${JSON.stringify(result.error)}`;
            console.error('[Email] Failed to send email notification:', result.error);
            console.error('[Email] Error details:', JSON.stringify(result.error, null, 2));
            return { success: false, error: errorMsg };
        }

        console.log('[Email] Email sent successfully:', result.data);
        return { success: true };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Email] Error sending email notification:', error);
        console.error('[Email] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        return { success: false, error: errorMsg };
    }
}

// Web Push通知を送信
export async function sendWebPushNotification(
    userId: string,
    taskTitle: string,
    dueDate: Date,
    notificationTime: string
): Promise<boolean> {
    console.log(`[WebPush] sendWebPushNotification called for user ${userId}, task: ${taskTitle}`);
    
    if (!vapidPublicKey || !vapidPrivateKey) {
        console.error('[WebPush] VAPID keys are not configured');
        console.error(`[WebPush] Public key exists: ${!!vapidPublicKey}, Private key exists: ${!!vapidPrivateKey}`);
        return false;
    }

    try {
        // ユーザーのWeb Pushサブスクリプションを取得
        console.log(`[WebPush] Fetching subscriptions for user ${userId}`);
        const subscriptions = await sql`
            SELECT endpoint, p256dh, auth
            FROM web_push_subscriptions
            WHERE user_id = ${userId}
        `;

        console.log(`[WebPush] Found ${subscriptions.length} subscription(s) for user ${userId}`);
        
        if (subscriptions.length === 0) {
            console.log(`[WebPush] No web push subscription found for user ${userId}`);
            return false;
        }

        const formattedDate = format(dueDate, 'yyyy年M月d日(E)', { locale: ja });
        const notificationPayload = JSON.stringify({
            title: '【さくっとタスク】タスクの通知',
            body: `${taskTitle} - ${formattedDate} ${notificationTime}`,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: `task-${userId}`,
            data: {
                url: '/top',
            },
        });

        // すべてのサブスクリプションに通知を送信
        console.log(`[WebPush] Sending notification to ${subscriptions.length} subscription(s)`);
        const sendPromises = subscriptions.map(async (sub: any, index: number) => {
            try {
                console.log(`[WebPush] Sending to subscription ${index + 1}/${subscriptions.length}, endpoint: ${sub.endpoint.substring(0, 50)}...`);
                await webpush.sendNotification(
                    {
                        endpoint: sub.endpoint,
                        keys: {
                            p256dh: sub.p256dh,
                            auth: sub.auth,
                        },
                    },
                    notificationPayload
                );
                console.log(`[WebPush] Successfully sent to subscription ${index + 1}`);
                return true;
            } catch (error: any) {
                // 無効なサブスクリプションは削除
                if (error.statusCode === 410 || error.statusCode === 404) {
                    console.log(`[WebPush] Subscription ${index + 1} is invalid (${error.statusCode}), deleting...`);
                    await sql`
                        DELETE FROM web_push_subscriptions
                        WHERE endpoint = ${sub.endpoint}
                    `;
                    console.log(`[WebPush] Deleted invalid subscription ${index + 1}`);
                }
                console.error(`[WebPush] Failed to send to subscription ${index + 1}:`, error);
                console.error(`[WebPush] Error details:`, {
                    statusCode: error.statusCode,
                    message: error.message,
                    body: error.body
                });
                return false;
            }
        });

        const results = await Promise.all(sendPromises);
        const successCount = results.filter(r => r).length;
        console.log(`[WebPush] Sent successfully to ${successCount}/${subscriptions.length} subscription(s)`);
        return results.some((success) => success);
    } catch (error) {
        console.error('Error sending web push notification:', error);
        return false;
    }
}

// 指定日・時刻の通知をすべて送信
export async function sendNotificationsForDateTime(
    targetDate: Date,
    targetTime: string
): Promise<{ emailCount: number; webPushCount: number; errors: string[] }> {
    console.log(`[Notification] Starting notification check for ${targetDate.toISOString().split('T')[0]} ${targetTime}`);
    const tasks = await getTasksToNotify(targetDate, targetTime);
    console.log(`[Notification] Found ${tasks.length} task(s) to notify`);
    
    const errors: string[] = [];
    let emailCount = 0;
    let webPushCount = 0;

    for (const task of tasks) {
        console.log(`[Notification] Processing task ${task.taskId} for user ${task.userId}: "${task.title}"`);
        
        // ユーザーの通知設定を取得
        const settings = await sql`
            SELECT email, email_notification_enabled, web_push_enabled
            FROM user_notification_settings
            WHERE user_id = ${task.userId}
            LIMIT 1
        `;

        if (settings.length === 0) {
            console.log(`[Notification] No notification settings found for user ${task.userId}, skipping`);
            continue; // 通知設定がないユーザーはスキップ
        }

        const setting = settings[0];
        console.log(`[Notification] User ${task.userId} settings: email_enabled=${setting.email_notification_enabled}, email=${setting.email || 'none'}, web_push_enabled=${setting.web_push_enabled}`);

        // メール通知を送信
        if (
            setting.email_notification_enabled &&
            setting.email &&
            task.notificationTime === targetTime
        ) {
            console.log(`[Notification] Sending email notification to ${setting.email} for task "${task.title}"`);
            const emailResult = await sendEmailNotification(
                setting.email,
                task.title,
                task.dueDate,
                task.notificationTime
            );
            if (emailResult.success) {
                emailCount++;
                console.log(`[Notification] Email sent successfully to ${setting.email}`);
            } else {
                const errorMsg = emailResult.error 
                    ? `Failed to send email to ${setting.email}: ${emailResult.error}`
                    : `Failed to send email to user ${task.userId} for task ${task.taskId}`;
                errors.push(errorMsg);
                console.error(`[Notification] ${errorMsg}`);
            }
        } else {
            if (!setting.email_notification_enabled) {
                console.log(`[Notification] Email notifications are disabled for user ${task.userId}`);
            } else if (!setting.email) {
                console.log(`[Notification] No email address set for user ${task.userId}`);
            } else if (task.notificationTime !== targetTime) {
                console.log(`[Notification] Notification time mismatch: task=${task.notificationTime}, target=${targetTime}`);
            }
        }

        // Web Push通知を送信
        if (setting.web_push_enabled && task.notificationTime === targetTime) {
            console.log(`[WebPush] Attempting to send push notification to user ${task.userId} for task ${task.taskId}`);
            const pushSent = await sendWebPushNotification(
                task.userId,
                task.title,
                task.dueDate,
                task.notificationTime
            );
            if (pushSent) {
                console.log(`[WebPush] Successfully sent push notification to user ${task.userId}`);
                webPushCount++;
            } else {
                const errorMsg = `Failed to send web push to user ${task.userId} for task ${task.taskId}`;
                errors.push(errorMsg);
                console.error(`[WebPush] ${errorMsg}`);
            }
        } else {
            if (!setting.web_push_enabled) {
                console.log(`[WebPush] Web push is disabled for user ${task.userId}`);
            } else if (task.notificationTime !== targetTime) {
                console.log(`[WebPush] Notification time mismatch: task=${task.notificationTime}, target=${targetTime}`);
            }
        }
    }

    console.log(`[Notification] Notification check completed: emailCount=${emailCount}, webPushCount=${webPushCount}, errors=${errors.length}`);
    return { emailCount, webPushCount, errors };
}
