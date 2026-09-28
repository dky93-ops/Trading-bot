#!/usr/bin/env python3
"""
ChatGPT Conversation Migration Script
======================================
Extracts and packages conversations from ChatGPT data export for migration to another account.
"""

import json, re, sys
from pathlib import Path
from datetime import datetime, timezone

PART_CHARS = 450_000

def ts(x):
    try:
        return datetime.fromtimestamp(float(x), timezone.utc).isoformat()
    except Exception:
        return "" if x is None else str(x)

def text_from_content(c):
    if c is None:
        return ""
    if isinstance(c, str):
        return c
    if isinstance(c, dict):
        p = c.get("parts")
        if isinstance(p, list):
            out = []
            for item in p:
                if isinstance(item, str):
                    out.append(item)
                elif isinstance(item, dict):
                    for k in ("text", "content", "value"):
                        if isinstance(item.get(k), str):
                            out.append(item[k])
                            break
            return "\n".join(out)
        for k in ("text", "content", "value"):
            if isinstance(c.get(k), str):
                return c[k]
    if isinstance(c, list):
        out = []
        for item in c:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict):
                for k in ("text", "content", "value"):
                    if isinstance(item.get(k), str):
                        out.append(item[k])
                        break
        return "\n".join(out)
    return ""

def load_conversations(root):
    files = list(root.rglob("*.json"))
    main = root / "conversations.json"
    if main.exists():
        files = [main] + [p for p in files if p != main]

    conversations = []
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue

        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("conversations", [])
        else:
            items = []

        if isinstance(items, dict):
            items = [items]

        for c in items:
            if isinstance(c, dict) and ("mapping" in c or "title" in c):
                conversations.append(c)

    seen = set()
    result = []
    for c in conversations:
        cid = str(c.get("conversation_id") or c.get("id") or "")
        if cid and cid in seen:
            continue
        if cid:
            seen.add(cid)
        result.append(c)
    return result

def get_messages(c):
    mapping = c.get("mapping", {})
    rows = []
    if not isinstance(mapping, dict):
        return rows

    for node_id, node in mapping.items():
        if not isinstance(node, dict):
            continue
        msg = node.get("message")
        if not isinstance(msg, dict):
            continue

        author = msg.get("author") or {}
        if not isinstance(author, dict):
            author = {}

        rows.append({
            "node_id": node_id,
            "role": str(author.get("role") or "unknown"),
            "name": author.get("name"),
            "time": msg.get("create_time", node.get("create_time")),
            "text": text_from_content(msg.get("content")),
            "metadata": msg.get("metadata", {})
        })

    rows.sort(key=lambda r: float(r["time"]) if isinstance(r["time"], (int, float)) else 0)
    return rows

def searchable_text(c):
    parts = [str(c.get("title") or "")]
    for m in get_messages(c)[:50]:
        parts.append(m["text"][:2000])
    return "\n".join(parts).lower()

def safe_name(s):
    s = re.sub(r'[<>:"/\\|?*]+', "_", s)
    s = re.sub(r"\s+", "_", s.strip())
    return (s[:100] or "conversation")

def main():
    prompt_path = input("Paste the FULL path to the EXTRACTED ChatGPT export folder: ").strip().strip('"')
    if not prompt_path:
        sys.exit("ERROR: No path provided.")
    root = Path(prompt_path).expanduser()
    if not root.is_dir():
        sys.exit("ERROR: folder not found. Extract the ChatGPT ZIP first.")

    conversations = load_conversations(root)
    if not conversations:
        sys.exit("ERROR: no conversation JSON data found.")

    query = input(
        "Enter a unique phrase from THIS chat, e.g. "
        "'MACD Adaptive SuperTrend': "
    ).strip().lower()

    ranked = []
    for c in conversations:
        hay = searchable_text(c)
        title = str(c.get("title") or "")
        score = hay.count(query) * 10 if query else 0
        if query and query in title.lower():
            score += 100

        for term, weight in [
            ("adaptive supertrend", 12),
            ("macd", 8),
            ("nifty", 5),
            ("ai studio", 2),
            ("trading-bot", 2),
        ]:
            score += hay.count(term) * weight

        ranked.append((score, title, c))

    ranked.sort(key=lambda x: (-x[0], x[1].lower()))

    print("\nPossible matches:\n")
    for i, (score, title, c) in enumerate(ranked[:20], 1):
        print(f"{i:2}. {title[:80]}   score={score}")

    choice = int(input("\nEnter the number of the EXACT conversation: ")) - 1
    if choice < 0 or choice >= min(20, len(ranked)):
        sys.exit("ERROR: invalid selection.")

    conversation = ranked[choice][2]
    rows = get_messages(conversation)
    title = str(conversation.get("title") or "Untitled conversation")

    out_dir = Path.cwd() / ("MIGRATION_" + safe_name(title))
    out_dir.mkdir(parents=True, exist_ok=True)
    upload_dir = out_dir / "upload_parts"
    upload_dir.mkdir(exist_ok=True)

    header = (
        f"# {title}\n\n"
        "## Metadata\n"
        f"- Conversation ID: `{conversation.get('conversation_id') or conversation.get('id') or ''}`\n"
        f"- Created: `{ts(conversation.get('create_time'))}`\n"
        f"- Updated: `{ts(conversation.get('update_time'))}`\n\n"
        "## Complete chronological transcript\n\n"
    )

    chunks_text = [header]
    for n, m in enumerate(rows, 1):
        role = m["role"] + (f" ({m['name']})" if m["name"] else "")
        chunks_text.append(f"### Message {n} — {role} — {ts(m['time'])}\n\n")
        chunks_text.append(m["text"] or "[No plain-text content in export.]")
        chunks_text.append("\n\n---\n\n")

    full = "".join(chunks_text)
    (out_dir / "FULL_CONVERSATION.md").write_text(full, encoding="utf-8")

    (out_dir / "CONVERSATION_METADATA.json").write_text(
        json.dumps({
            "title": title,
            "conversation_id": conversation.get("conversation_id") or conversation.get("id"),
            "message_count": len(rows)
        }, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    # Split at message boundaries.
    parts = []
    current = ""
    for block in re.split(r"(?=### Message \d+)", full):
        if current and len(current) + len(block) > PART_CHARS:
            parts.append(current)
            current = ""
        current += block
    if current:
        parts.append(current)

    for i, part in enumerate(parts, 1):
        (upload_dir / f"conversation_part_{i:03}.md").write_text(part, encoding="utf-8")

    start_here = (
        "MIGRATED CHAT — START HERE\n"
        "==========================\n\n"
        f"Conversation: {title}\n\n"
        "NEW ACCOUNT STEPS\n"
        "1. Start a new ChatGPT conversation.\n"
        "2. Upload FULL_CONVERSATION.md.\n"
        "3. If it is too large, upload every file in upload_parts instead.\n"
        "4. Also upload the original files/assets from the old export that this chat used.\n"
        "5. Then send this message:\n\n"
        "You are continuing a conversation migrated from another ChatGPT account. "
        "Treat the uploaded migration files as the source of truth for the prior conversation. "
        "Read the complete transcript before answering. Preserve prior decisions, corrections, "
        "terminology, rules, filenames, benchmark figures, and unresolved caveats. "
        "Do not invent missing information.\n"
    )
    (out_dir / "START_HERE.txt").write_text(start_here, encoding="utf-8")

    print("\nDONE")
    print("Migration folder:", out_dir.resolve())
    print("Upload this file:", (out_dir / "FULL_CONVERSATION.md").resolve())
    print("Or upload all files in:", upload_dir.resolve())

if __name__ == "__main__":
    main()
