import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';

interface ImportTask {
    id?: string;
    title: string;
    due_date: string;
    notification_time: string | null;
    notification_enabled: boolean;
    created_at?: string;
    updated_at?: string;
    recurrence?: {
        type: string;
        custom_days: number | null;
        custom_unit: string | null;
        weekdays: number[] | null;
    } | null;
    exclusions?: Array<{
        excluded_date: string;
        exclusion_type: string;
    }>;
}

interface ImportMemorial {
    id?: string;
    title: string;
    due_date: string;
    notification_time: string | null;
    notification_enabled: boolean;
    created_at?: string;
    updated_at?: string;
    recurrence?: {
        type: string;
        custom_days: number | null;
        custom_unit: string | null;
        weekdays: number[] | null;
    } | null;
}

interface ImportData {
    version?: string;
    exportedAt?: string;
    tasks?: ImportTask[];
    memorials?: ImportMemorial[];
}

export async function POST(request: NextRequest) {
    try {
        // 認証チェック
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = user.id;

        // リクエストボディを取得
        const importData: ImportData = await request.json();

        if (!importData || (!importData.tasks && !importData.memorials)) {
            return NextResponse.json(
                { error: 'Invalid import data' },
                { status: 400 }
            );
        }

        let importedTasks = 0;
        let importedMemorials = 0;
        const errors: string[] = [];

        // タスクをインポート
        if (importData.tasks && Array.isArray(importData.tasks)) {
            for (const task of importData.tasks) {
                try {
                    // 必須フィールドの検証
                    if (!task.title || typeof task.title !== 'string' || !task.title.trim()) {
                        errors.push('タイトルが未入力のタスクはスキップされました');
                        continue;
                    }
                    if (!task.due_date || typeof task.due_date !== 'string' || isNaN(Date.parse(task.due_date))) {
                        errors.push(`タスク「${task.title}」: 日付が不正です`);
                        continue;
                    }
                    if (task.recurrence && task.recurrence.weekdays !== null && task.recurrence.weekdays !== undefined && !Array.isArray(task.recurrence.weekdays)) {
                        errors.push(`タスク「${task.title}」: weekdays は配列である必要があります`);
                        continue;
                    }

                    // 新しいUUIDを生成（既存データとの競合を避ける）
                    const newTaskId = randomUUID();

                    // タスクを挿入
                    await sql`
                        INSERT INTO tasks (id, user_id, title, due_date, notification_enabled, notification_time, created_at, updated_at)
                        VALUES (
                            ${newTaskId},
                            ${userId},
                            ${task.title},
                            ${task.due_date},
                            ${task.notification_enabled || false},
                            ${task.notification_time || null},
                            ${task.created_at || new Date().toISOString()},
                            ${task.updated_at || new Date().toISOString()}
                        )
                    `;

                    // 繰り返し設定がある場合
                    if (task.recurrence && task.recurrence.type) {
                        await sql`
                            INSERT INTO task_recurrences (task_id, type, custom_days, custom_unit, weekdays)
                            VALUES (
                                ${newTaskId},
                                ${task.recurrence.type},
                                ${task.recurrence.custom_days || null},
                                ${task.recurrence.custom_unit || null},
                                ${task.recurrence.weekdays || null}
                            )
                        `;
                    }

                    // 除外設定がある場合
                    if (task.exclusions && Array.isArray(task.exclusions)) {
                        for (const exclusion of task.exclusions) {
                            await sql`
                                INSERT INTO task_exclusions (task_id, excluded_date, exclusion_type)
                                VALUES (
                                    ${newTaskId},
                                    ${exclusion.excluded_date},
                                    ${exclusion.exclusion_type}
                                )
                                ON CONFLICT (task_id, excluded_date, exclusion_type) DO NOTHING
                            `;
                        }
                    }

                    importedTasks++;
                } catch (error) {
                    console.error('Error importing task:', error);
                    errors.push(`タスク「${task.title}」のインポートに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        }

        // 記念日をインポート
        if (importData.memorials && Array.isArray(importData.memorials)) {
            for (const memorial of importData.memorials) {
                try {
                    // 必須フィールドの検証
                    if (!memorial.title || typeof memorial.title !== 'string' || !memorial.title.trim()) {
                        errors.push('タイトルが未入力の記念日はスキップされました');
                        continue;
                    }
                    if (!memorial.due_date || typeof memorial.due_date !== 'string' || isNaN(Date.parse(memorial.due_date))) {
                        errors.push(`記念日「${memorial.title}」: 日付が不正です`);
                        continue;
                    }
                    if (memorial.recurrence && memorial.recurrence.weekdays !== null && memorial.recurrence.weekdays !== undefined && !Array.isArray(memorial.recurrence.weekdays)) {
                        errors.push(`記念日「${memorial.title}」: weekdays は配列である必要があります`);
                        continue;
                    }

                    // 新しいUUIDを生成（既存データとの競合を避ける）
                    const newMemorialId = randomUUID();

                    // 記念日を挿入
                    await sql`
                        INSERT INTO memorials (id, user_id, title, due_date, notification_enabled, notification_time, created_at, updated_at)
                        VALUES (
                            ${newMemorialId},
                            ${userId},
                            ${memorial.title},
                            ${memorial.due_date},
                            ${memorial.notification_enabled || false},
                            ${memorial.notification_time || null},
                            ${memorial.created_at || new Date().toISOString()},
                            ${memorial.updated_at || new Date().toISOString()}
                        )
                    `;

                    // 繰り返し設定がある場合
                    if (memorial.recurrence && memorial.recurrence.type) {
                        await sql`
                            INSERT INTO memorial_recurrences (memorial_id, type, custom_days, custom_unit, weekdays)
                            VALUES (
                                ${newMemorialId},
                                ${memorial.recurrence.type},
                                ${memorial.recurrence.custom_days || null},
                                ${memorial.recurrence.custom_unit || null},
                                ${memorial.recurrence.weekdays || null}
                            )
                        `;
                    }

                    importedMemorials++;
                } catch (error) {
                    console.error('Error importing memorial:', error);
                    errors.push(`記念日「${memorial.title}」のインポートに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        }

        return NextResponse.json({
            success: true,
            importedTasks,
            importedMemorials,
            errors: errors.length > 0 ? errors : undefined,
        });
    } catch (error) {
        console.error('Import error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Import failed' },
            { status: 500 }
        );
    }
}
