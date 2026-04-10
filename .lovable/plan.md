

# Knowledge Repository: Installing the Minds of the Greats

## The Concept

You want a **wisdom engine** -- a searchable database of mental models, frameworks, strategies, and philosophies from the world's best entrepreneurs, marketers, and CEOs. When you're chatting with Ozlon about a business problem, it pulls the most relevant wisdom and applies it.

## Where It Lives

**Two new database tables in your Lovable Cloud backend:**

### 1. `knowledge_entries` -- The Raw Wisdom
Stores individual pieces of knowledge: principles, frameworks, quotes, strategies.

| Column | Purpose |
|--------|---------|
| `id` | Primary key |
| `user_id` | Owner (so each user can have their own library) |
| `source_person` | "Alex Hormozi", "Charlie Munger", "Steve Jobs" |
| `source_material` | "$100M Offers", "Poor Charlie's Almanack", etc. |
| `category` | `framework`, `principle`, `strategy`, `mental_model`, `quote`, `playbook` |
| `domain` | `marketing`, `sales`, `leadership`, `finance`, `ops`, `product`, `mindset` |
| `title` | Short name: "The Value Equation", "Inversion Thinking" |
| `content` | The actual knowledge -- detailed explanation |
| `embedding` | 1536-dim vector (pgvector) for semantic search |
| `tags` | Array of searchable tags |
| `created_at` | Timestamp |

### 2. `knowledge_sources` -- Track What's Been Ingested
Tracks books, podcasts, courses you've loaded so you don't duplicate.

| Column | Purpose |
|--------|---------|
| `id` | Primary key |
| `user_id` | Owner |
| `person` | Author/speaker |
| `title` | Book/course/podcast name |
| `type` | `book`, `course`, `podcast`, `article`, `framework_set` |
| `entry_count` | How many entries extracted |
| `created_at` | Timestamp |

## How It Gets Smart

### Ingestion Edge Function (`knowledge-ingest`)
An edge function that:
1. Takes raw text (book summaries, framework descriptions, or structured JSON)
2. Uses AI to break it into discrete knowledge entries (principles, frameworks, mental models)
3. Generates vector embeddings for each entry
4. Stores everything in the database

You can feed it by:
- Pasting book summaries or notes
- Uploading documents through chat
- Asking Ozlon to "learn about Alex Hormozi's value equation" and it researches + stores it
- Pre-seeding with curated framework packs

### Semantic Search Function (`match_knowledge`)
A Postgres function using pgvector that finds the most relevant knowledge entries based on what you're currently discussing. When you say "how should I price my offer?", it pulls Hormozi's Value Equation, Munger's pricing mental models, etc.

## How It Connects to Chat

Update the chat edge function to:
1. Detect when business/strategy context would help
2. Run a semantic search against your knowledge repository
3. Inject the top 5-10 most relevant frameworks/principles into the AI's context
4. The AI applies those frameworks to your specific situation

## Implementation Steps

1. **Enable pgvector extension** in the database
2. **Create `knowledge_sources` and `knowledge_entries` tables** with RLS policies
3. **Create `match_knowledge` SQL function** for similarity search
4. **Build `knowledge-ingest` edge function** -- accepts text, breaks into entries, embeds, stores
5. **Build `knowledge-search` edge function** -- semantic search endpoint
6. **Update chat edge function** -- auto-inject relevant knowledge into conversations
7. **Pre-seed with starter pack** -- load 50-100 high-value frameworks from Hormozi, Munger, Bezos, Jobs, Musk, Buffett, Dalio, etc.
8. **Add Knowledge section to Settings** -- view sources, entry counts, add new material

## Technical Details

- **pgvector** for vector similarity search (already architected for your memories table)
- **OpenAI text-embedding-3-small** for generating embeddings (key already configured)
- **Cosine similarity** for matching relevance
- All knowledge is per-user with RLS, so this scales to multiple users
- The existing `memories` table stays separate -- memories are about *you*, knowledge is about *the world*

