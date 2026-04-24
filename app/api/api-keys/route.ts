import { getUserId } from "@/lib/apiKey"
import { createDb } from "@/lib/db"
import { apiKeys } from "@/lib/schema"
import { nanoid } from "nanoid"
import { NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"

export const runtime = "edge"

export async function GET() {
  const startedAt = Date.now()
  const timings: string[] = []
  const json = (body: unknown, init?: ResponseInit) => {
    const headers = new Headers(init?.headers)
    headers.set('Server-Timing', [...timings, `total;dur=${Date.now() - startedAt}`].join(', '))
    return NextResponse.json(body, { ...init, headers })
  }

  const userStartedAt = Date.now()
  const userId = await getUserId()
  timings.push(`user;dur=${Date.now() - userStartedAt}`)

  try {
    const db = createDb()
    const keys = await db.query.apiKeys.findMany({
      where: eq(apiKeys.userId, userId!),
      orderBy: desc(apiKeys.createdAt),
    })

    return json({
      apiKeys: keys.map(key => ({
        ...key,
        key: undefined
      }))
    })
  } catch (error) {
    console.error("Failed to fetch API keys:", error)
    return json(
      { error: "获取 API Keys 失败" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const userId = await getUserId()
  try {
    const { name } = await request.json() as { name: string }
    if (!name?.trim()) {
      return NextResponse.json(
        { error: "名称不能为空" },
        { status: 400 }
      )
    }

    const key = `mk_${nanoid(32)}`
    const db = createDb()
    
    await db.insert(apiKeys).values({
      name,
      key,
      userId: userId!,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    })

    return NextResponse.json({ key })
  } catch (error) {
    console.error("Failed to create API key:", error)
    return NextResponse.json(
      { error: "创建 API Key 失败" },
      { status: 500 }
    )
  }
} 