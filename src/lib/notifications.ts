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
    const targetDateStr = targetDate.toISOString().split('T')[0];
    console.log(`[Notification] Getting tasks to notify for date ${targetDateStr} at time ${targetTime}`);
    console.log(`[Notification] Target date details:`, {
        targetDateISO: targetDate.toISOString(),
        targetDateStr,
        targetTime,
        targetDateYear: targetDate.getFullYear(),
        targetDateMonth: targetDate.getMonth() + 1,
        targetDateDay: targetDate.getDate()
    });
    
    // 指定時刻に通知が必要なタスクをすべて取得
    // 注意: notification_timeは文字列型なので、トリムして比較
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
            AND TRIM(t.notification_time) = TRIM(${targetTime})
    `;

    console.log(`[Notification] Found ${tasks.length} task(s) with notification_enabled=true and notification_time=${targetTime}`);
    
    // デバッグ: 実際に取得されたタスクの詳細をログ出力
    if (tasks.length > 0) {
        console.log(`[Notification] Retrieved tasks:`, tasks.map((t: any) => ({
            id: t.task_id,
            title: t.title,
            notification_time: t.notification_time,
            due_date: t.due_date,
            recurrence_type: t.recurrence_type
        })));
    } else {
        // 通知が有効なタスクをすべて取得して、なぜマッチしないか確認
        // 特に、通知時刻が設定されているタスクを詳しく確認
        const allEnabledTasks = await sql`
            SELECT 
                t.id as task_id,
                t.title,
                t.notification_time,
                t.due_date,
                tr.type as recurrence_type
            FROM tasks t
            LEFT JOIN task_recurrences tr ON t.id = tr.task_id
            WHERE t.notification_enabled = true
            AND t.notification_time IS NOT NULL
            AND t.notification_time != ''
            ORDER BY t.created_at DESC
            LIMIT 20
        `;
        console.log(`[Notification] All enabled tasks with notification_time (recent 20):`, allEnabledTasks.map((t: any) => ({
            id: t.task_id,
            title: t.title,
            notification_time: t.notification_time,
            notification_time_trimmed: t.notification_time ? String(t.notification_time).trim() : null,
            target_time: targetTime,
            target_time_trimmed: targetTime.trim(),
            matches: t.notification_time ? String(t.notification_time).trim() === targetTime.trim() : false,
            due_date: t.due_date,
            recurrence_type: t.recurrence_type
        })));
        
        // さらに、通知時刻が近いタスクを検索（5分以内）
        const targetHour = parseInt(targetTime.split(':')[0]);
        const targetMin = parseInt(targetTime.split(':')[1]);
        const nearbyTasks = await sql`
            SELECT 
                t.id as task_id,
                t.title,
                t.notification_time,
                t.due_date
            FROM tasks t
            WHERE t.notification_enabled = true
            AND t.notification_time IS NOT NULL
            AND t.notification_time != ''
            AND (
                t.notification_time LIKE ${`${String(targetHour).padStart(2, '0')}:%`}
                OR t.notification_time LIKE ${targetHour > 0 ? `${String(targetHour - 1).padStart(2, '0')}:%` : '23:%'}
                OR t.notification_time LIKE ${targetHour < 23 ? `${String(targetHour + 1).padStart(2, '0')}:%` : '00:%'}
            )
            LIMIT 10
        `;
        if (nearbyTasks.length > 0) {
            console.log(`[Notification] Nearby notification times found:`, nearbyTasks.map((t: any) => ({
                id: t.task_id,
                title: t.title,
                notification_time: t.notification_time,
                due_date: t.due_date
            })));
        }
    }

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
            const isMatchingDate = isSameDay(taskDueDate, targetDate);
            console.log(`[Notification] Checking single task ${task.task_id}: "${task.title}"`, {
                taskDueDate: taskDueDate.toISOString().split('T')[0],
                targetDate: targetDateNormalized.toISOString().split('T')[0],
                isMatchingDate,
                notificationTime: task.notification_time
            });
            
            if (isMatchingDate) {
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
): Promise<{ success: boolean; error?: string }> {
    console.log(`[WebPush] sendWebPushNotification called for user ${userId}, task: ${taskTitle}`);
    
    if (!vapidPublicKey || !vapidPrivateKey) {
        const errorMsg = 'VAPID keys are not configured';
        console.error(`[WebPush] ${errorMsg}`);
        console.error(`[WebPush] Public key exists: ${!!vapidPublicKey}, Private key exists: ${!!vapidPrivateKey}`);
        return { success: false, error: errorMsg };
    }

    try {
        // ユーザーのWeb Pushサブスクリプションを取得
        console.log(`[WebPush] Fetching subscriptions for user ${userId}`);
        
        // デバッグ: データベース内のすべてのサブスクリプションを確認
        const allSubscriptions = await sql`
            SELECT user_id, endpoint, created_at, updated_at
            FROM web_push_subscriptions
            ORDER BY created_at DESC
            LIMIT 10
        `;
        console.log(`[WebPush] Debug: Total subscriptions in database (recent 10):`, allSubscriptions.map((s: any) => ({
            user_id: s.user_id,
            endpoint: s.endpoint.substring(0, 50) + '...',
            created_at: s.created_at,
            updated_at: s.updated_at
        })));
        
        const subscriptions = await sql`
            SELECT endpoint, p256dh, auth
            FROM web_push_subscriptions
            WHERE user_id = ${userId}
        `;

        console.log(`[WebPush] Found ${subscriptions.length} subscription(s) for user ${userId}`);
        
        if (subscriptions.length === 0) {
            // デバッグ: このユーザーIDで検索したが見つからなかった
            // 念のため、すべてのユーザーのサブスクリプションを確認
            const allUserSubscriptions = await sql`
                SELECT user_id, endpoint, created_at, updated_at
                FROM web_push_subscriptions
                ORDER BY created_at DESC
                LIMIT 20
            `;
            console.log(`[WebPush] Debug: Looking for subscriptions for user ${userId}`);
            console.log(`[WebPush] Debug: All subscriptions in DB (showing user_ids):`, 
                allUserSubscriptions.map((s: any) => ({
                    user_id: s.user_id,
                    matches_target: s.user_id === userId,
                    endpoint_preview: s.endpoint.substring(0, 50) + '...'
                }))
            );
            
            // ユーザーIDが完全一致しない場合も確認（文字列比較の問題など）
            const similarSubscriptions = await sql`
                SELECT user_id, endpoint, created_at, updated_at
                FROM web_push_subscriptions
                WHERE user_id::text LIKE ${`%${userId}%`}
                LIMIT 10
            `;
            if (similarSubscriptions.length > 0) {
                console.log(`[WebPush] Debug: Found ${similarSubscriptions.length} subscription(s) with similar user_id:`, 
                    similarSubscriptions.map((s: any) => ({
                        user_id: s.user_id,
                        user_id_type: typeof s.user_id,
                        target_user_id: userId,
                        target_user_id_type: typeof userId
                    }))
                );
            }
            
            const errorMsg = `No web push subscription found for user ${userId}`;
            console.error(`[WebPush] ${errorMsg}`);
            return { success: false, error: errorMsg };
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
                return { success: true };
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
                const errorDetails = {
                    statusCode: error.statusCode,
                    message: error.message,
                    body: error.body,
                    endpoint: sub.endpoint.substring(0, 50) + '...'
                };
                console.error(`[WebPush] Failed to send to subscription ${index + 1}:`, error);
                console.error(`[WebPush] Error details:`, errorDetails);
                return { success: false, error: `Subscription ${index + 1} failed: ${error.statusCode || 'unknown'} - ${error.message || 'unknown error'}` };
            }
        });

        const results = await Promise.all(sendPromises);
        const successCount = results.filter(r => r.success).length;
        const failedResults = results.filter(r => !r.success);
        console.log(`[WebPush] Sent successfully to ${successCount}/${subscriptions.length} subscription(s)`);
        
        if (failedResults.length > 0) {
            const errorMessages = failedResults.map(r => r.error).filter(Boolean);
            return {
                success: successCount > 0,
                error: errorMessages.length > 0 ? errorMessages.join('; ') : 'Some subscriptions failed'
            };
        }
        
        return { success: true };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[WebPush] Error sending web push notification:', error);
        console.error('[WebPush] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        return { success: false, error: errorMsg };
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

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        console.log(`[Notification] Processing task ${i + 1}/${tasks.length}: ${task.taskId} for user ${task.userId}: "${task.title}"`);
        
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
        // 注意: SQLクエリで既に時刻でフィルタリングされているので、重複チェックは不要
        // Resendのレート制限（2リクエスト/秒）に対応するため、前のメール送信から0.6秒待機
        if (setting.email_notification_enabled && setting.email) {
            if (i > 0) {
                // 2つ目以降のメール送信の前に待機（レート制限対策）
                await new Promise(resolve => setTimeout(resolve, 600)); // 0.6秒待機
            }
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
                
                // レート制限エラーの場合は、次のメール送信まで長めに待機
                if (emailResult.error && emailResult.error.includes('rate_limit')) {
                    console.log(`[Notification] Rate limit detected, waiting 1 second before next email...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } else {
            if (!setting.email_notification_enabled) {
                console.log(`[Notification] Email notifications are disabled for user ${task.userId}`);
            } else if (!setting.email) {
                console.log(`[Notification] No email address set for user ${task.userId}`);
            }
        }

        // Web Push通知を送信
        // 注意: SQLクエリで既に時刻でフィルタリングされているので、重複チェックは不要
        console.log(`[Notification] Checking web_push_enabled for user ${task.userId}: ${setting.web_push_enabled}`);
        
        if (setting.web_push_enabled) {
            console.log(`[WebPush] Attempting to send push notification to user ${task.userId} for task ${task.taskId}`);
            
            // デバッグ: サブスクリプションの存在を事前確認
            const preCheck = await sql`
                SELECT COUNT(*) as count
                FROM web_push_subscriptions
                WHERE user_id = ${task.userId}
            `;
            console.log(`[WebPush] Pre-check: User ${task.userId} has ${preCheck[0].count} subscription(s) in database`);
            
            const pushResult = await sendWebPushNotification(
                task.userId,
                task.title,
                task.dueDate,
                task.notificationTime
            );
            if (pushResult.success) {
                console.log(`[WebPush] Successfully sent push notification to user ${task.userId}`);
                webPushCount++;
            } else {
                const errorMsg = pushResult.error 
                    ? `Failed to send web push to user ${task.userId} for task ${task.taskId}: ${pushResult.error}`
                    : `Failed to send web push to user ${task.userId} for task ${task.taskId}`;
                errors.push(errorMsg);
                console.error(`[WebPush] ${errorMsg}`);
            }
        } else {
            console.log(`[WebPush] Web push is disabled for user ${task.userId} (web_push_enabled=false)`);
        }
    }

    console.log(`[Notification] Notification check completed: emailCount=${emailCount}, webPushCount=${webPushCount}, errors=${errors.length}`);
    return { emailCount, webPushCount, errors };
}
