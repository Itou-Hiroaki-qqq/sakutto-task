import { Resend } from 'resend';
import { sql } from './db';
import { format, isSameDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { shouldIncludeRecurringTask } from './tasks';

// Resendクライアントの初期化
const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

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

        if (!task.recurrence_type) {
            // 単発タスク（繰り返しなし）
            if (isSameDay(taskDueDate, targetDate)) {
                result.push({
                    taskId: task.task_id,
                    userId: task.user_id,
                    title: task.title,
                    dueDate: taskDueDate,
                    notificationTime: task.notification_time,
                });
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
                result.push({
                    taskId: task.task_id,
                    userId: task.user_id,
                    title: task.title,
                    dueDate: taskDueDate,
                    notificationTime: task.notification_time,
                });
            }
        }
    }

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

        const result = await resend.emails.send({
            from: fromAddress,
            to: email,
            subject: subject,
            html: htmlContent,
        });

        if (result.error) {
            const errorMsg = `Resend API error: ${JSON.stringify(result.error)}`;
            console.error('[Email] Failed to send email notification:', result.error);
            return { success: false, error: errorMsg };
        }

        return { success: true };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Email] Error sending email notification:', error);
        return { success: false, error: errorMsg };
    }
}


// 指定日・時刻の通知をすべて送信
export async function sendNotificationsForDateTime(
    targetDate: Date,
    targetTime: string
): Promise<{ emailCount: number; webPushCount: number; errors: string[] }> {
    const tasks = await getTasksToNotify(targetDate, targetTime);

    if (tasks.length === 0) {
        return { emailCount: 0, webPushCount: 0, errors: [] };
    }

    const errors: string[] = [];
    let emailCount = 0;

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        // ユーザーの通知設定を取得
        const settings = await sql`
            SELECT email, email_notification_enabled
            FROM user_notification_settings
            WHERE user_id = ${task.userId}
            LIMIT 1
        `;

        if (settings.length === 0) {
            continue;
        }

        const setting = settings[0];

        // メール通知を送信
        // Resendのレート制限（2リクエスト/秒）に対応するため、前のメール送信から0.6秒待機
        if (setting.email_notification_enabled && setting.email) {
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 600));
            }
            const emailResult = await sendEmailNotification(
                setting.email,
                task.title,
                task.dueDate,
                task.notificationTime
            );
            if (emailResult.success) {
                emailCount++;
            } else {
                const errorMsg = emailResult.error
                    ? `Failed to send email to ${setting.email}: ${emailResult.error}`
                    : `Failed to send email to user ${task.userId} for task ${task.taskId}`;
                errors.push(errorMsg);
                console.error(`[Notification] ${errorMsg}`);

                // レート制限エラーの場合は、次のメール送信まで長めに待機
                if (emailResult.error && emailResult.error.includes('rate_limit')) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    }

    return { emailCount, webPushCount: 0, errors };
}
