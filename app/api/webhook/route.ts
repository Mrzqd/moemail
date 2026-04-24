import { getUserId } from "@/lib/apiKey"
import { createDb } from "@/lib/db"
import { webhooks } from "@/lib/schema"
import { eq } from "drizzle-orm"
import { z } from "zod"

export const runtime = "edge"

const webhookSchema = z.object({
  url: z.string().url(),
  enabled: z.boolean()
})

export async function GET() {
  const startedAt = Date.now()
  const timings: string[] = []
  const json = (body: unknown, init?: ResponseInit) => {
    const headers = new Headers(init?.headers)
    headers.set('Server-Timing', [...timings, `total;dur=${Date.now() - startedAt}`].join(', '))
    return Response.json(body, { ...init, headers })
  }

  const userStartedAt = Date.now()
  const userId = await getUserId()
  timings.push(`user;dur=${Date.now() - userStartedAt}`)

  const db = createDb()
  const dbStartedAt = Date.now()
  const webhook = await db.query.webhooks.findFirst({
    where: eq(webhooks.userId, userId!)
  })
  timings.push(`db;dur=${Date.now() - dbStartedAt}`)

  return json(webhook || { enabled: false, url: "" })
}

export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { url, enabled } = webhookSchema.parse(body)
    
    const db = createDb()
    const now = new Date()

    const existingWebhook = await db.query.webhooks.findFirst({
      where: eq(webhooks.userId, userId)
    })

    if (existingWebhook) {
      await db
        .update(webhooks)
        .set({
          url,
          enabled,
          updatedAt: now
        })
        .where(eq(webhooks.userId, userId))
    } else {
      await db
        .insert(webhooks)
        .values({
          userId,
          url,
          enabled,
        })
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error("Failed to save webhook:", error)
    return Response.json(
      { error: "Invalid request" },
      { status: 400 }
    )
  }
} 