import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Gemini APIのエンドポイント
// ListModelsで確認した結果、v1betaで以下のモデルが利用可能：
// - gemini-2.5-flash (推奨: 画像認識対応、generateContentサポート)
// - gemini-2.5-pro (より高機能だが処理が遅い可能性)
// - gemini-flash-latest (最新版)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.5-flash';

interface ExtractedEvent {
    date: string;
    title: string;
    description?: string;
    type?: string;
    keyword: string;
}

// ファイルをBase64に変換
async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return base64;
}

// Gemini APIに画像を送信してJSONを取得
async function processWithGemini(
    base64Images: string[],
    mimeTypes: string[]
): Promise<ExtractedEvent[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not set');
    }

    // プロンプトを作成
    const prompt = `以下の画像は学校や会社の年間行事予定表です。画像から行事予定を抽出して、以下のJSON形式で返してください。

{
    "events": [
    {
        "date": "YYYY-MM-DD形式の日付",
        "title": "行事のタイトル（時刻が含まれる場合は「HH:mm 行事名」の形式）",
        "description": "説明（あれば）",
        "type": "全校/2年/3年/会議/イベントなど",
        "keyword": "予定表を識別するキーワード（例: 三小、会社など）"
    }
    ]
}

注意事項:
- 日付は必ずYYYY-MM-DD形式で出力してください
- 年度表記があれば判定してください（例: 令和7年度 → 2025年4月～2026年3月）
- keywordは予定表の種類を表す識別子です（学校名、会社名など）
- すべての行事を抽出してください
- タイトルは予定表に記載されている通り、完全に抽出してください。括弧や数字（例: (6)、(1)(2)など）を含む場合は、それらも省略せずに含めてください。例えば「前日準備(6)」の場合は「前日準備(6)」と抽出し、「前日準備」のように省略しないでください
- 予定表に時刻が記載されている場合（例: 「11:00 元旦会」「午前十時 入学式」など）、タイトルに時刻を含めて抽出してください
- 時刻の表記方法:
  * 予定表の時刻表記が「九時」「午前十時」「午後二時十五分」「（全角で）１１：３０」「（漢字と数字交じりで）午前10時45分」などの形式の場合、半角数字の24時間表記に変換してください
  * 変換例:
    - 「九時」→「9:00」
    - 「午前十時」→「10:00」
    - 「午後二時十五分」→「14:15」
    - 「１１：３０」（全角）→「11:30」
    - 「午前10時45分」→「10:45」
    - 「午後2時30分」→「14:30」
  * タイトルは「HH:mm 行事名」の形式で出力してください（例: 「11:00 元旦会」「14:30 全校集会」）

JSONのみを返してください。`;

    // Gemini APIに送信するデータを作成
    const parts: any[] = [{ text: prompt }];

    // 画像を追加
    for (let i = 0; i < base64Images.length; i++) {
        parts.push({
            inline_data: {
                mime_type: mimeTypes[i],
                data: base64Images[i],
            },
        });
    }

    const requestBody = {
        contents: [
            {
                parts,
            },
        ],
    };

    try {
        const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();

            // エラーの詳細を解析
            let errorMessage = `Gemini API error: ${response.status}`;
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.error?.message) {
                    errorMessage += ` - ${errorData.error.message}`;
                }
            } catch (e) {
                // JSON解析に失敗した場合はテキストのまま使用
                if (errorText) {
                    errorMessage += ` - ${errorText.substring(0, 200)}`;
                }
            }

            throw new Error(errorMessage);
        }

        const data = await response.json();

        // レスポンスからテキストを抽出
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error('No response from Gemini API');
        }

        // JSON部分を抽出（```json と ``` で囲まれている可能性がある）
        let jsonText = text.trim();
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        const parsed = JSON.parse(jsonText);
        return parsed.events || [];
    } catch (error) {
        console.error('Error processing with Gemini:', error);
        throw error;
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await request.formData();
        const files = formData.getAll('files') as File[];

        if (files.length === 0) {
            return NextResponse.json({ error: 'No files provided' }, { status: 400 });
        }

        if (files.length > 2) {
            return NextResponse.json({ error: 'Maximum 2 files allowed' }, { status: 400 });
        }

        // ファイルをBase64に変換
        const base64Images: string[] = [];
        const mimeTypes: string[] = [];

        for (const file of files) {
            // PDFの場合はそのまま、画像の場合は画像として処理
            const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

            const base64 = await fileToBase64(file);
            base64Images.push(base64);
            mimeTypes.push(mimeType);
        }

        // Gemini APIで処理
        const events = await processWithGemini(base64Images, mimeTypes);

        return NextResponse.json({ events });
    } catch (error) {
        console.error('Error in upload endpoint:', error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Internal server error',
            },
            { status: 500 }
        );
    }
}
