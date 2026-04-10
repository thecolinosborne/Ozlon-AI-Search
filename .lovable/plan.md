

# GHL Tier 3: Social Planner, Blogs, Products, Courses, Surveys, Media, Companies, and Links

## What's Being Added

Based on the GHL API v2 scopes and endpoints, here are all Tier 3 capabilities to add:

### Social Planner (6 actions)
| Action | Endpoint | Method |
|--------|----------|--------|
| `list_social_accounts` | `GET /social-media-posting/{locationId}/accounts` | Read |
| `list_social_posts` | `GET /social-media-posting/{locationId}/posts` | Read |
| `get_social_post` | `GET /social-media-posting/{locationId}/posts/{id}` | Read |
| `create_social_post` | `POST /social-media-posting/{locationId}/posts` | Write |
| `edit_social_post` | `PUT /social-media-posting/{locationId}/posts/{id}` | Write |
| `delete_social_post` | `DELETE /social-media-posting/{locationId}/posts/{id}` | Write |

### Products (5 actions)
| Action | Endpoint | Method |
|--------|----------|--------|
| `list_products` | `GET /products/?locationId=` | Read |
| `get_product` | `GET /products/{productId}` | Read |
| `create_product` | `POST /products/` | Write |
| `update_product` | `PUT /products/{productId}` | Write |
| `delete_product` | `DELETE /products/{productId}` | Write |

### Courses (2 actions)
| Action | Endpoint | Method |
|--------|----------|--------|
| `list_courses` | `GET /courses/?locationId=` | Read |
| `import_courses` | `POST /courses/courses-exporter/public/import` | Write |

### Surveys (2 actions)
| Action | Endpoint | Method |
|--------|----------|--------|
| `list_surveys` | `GET /surveys/?locationId=` | Read |
| `get_survey_submissions` | `GET /surveys/submissions?locationId=&surveyId=` | Read |

### Blogs (3 actions)
| Action | Endpoint | Method |
|--------|----------|--------|
| `list_blog_posts` | `GET /blogs/posts?locationId=` | Read |
| `get_blog_post` | `GET /blogs/posts/{postId}` | Read |
| `create_blog_post` | `POST /blogs/posts` | Write |

### Media (2 actions)
| Action | Endpoint | Method |
|--------|----------|--------|
| `list_media_files` | `GET /medias/files?altId={locationId}&altType=location` | Read |
| `upload_media_file` | `POST /medias/upload-file` | Write (multipart) |

### Companies (2 actions)
| Action | Endpoint | Method |
|--------|----------|--------|
| `list_companies` | `GET /companies/?locationId=` | Read |
| `get_company` | `GET /companies/{companyId}` | Read |

### Links (3 actions)
| Action | Endpoint | Method |
|--------|----------|--------|
| `list_links` | `GET /links/?locationId=` | Read |
| `create_link` | `POST /links/` | Write |
| `update_link` | `PUT /links/{linkId}` | Write |

### Businesses (2 actions)
| Action | Endpoint | Method |
|--------|----------|--------|
| `list_businesses` | `GET /businesses/?locationId=` | Read |
| `get_business` | `GET /businesses/{businessId}` | Read |

**Total: ~27 new actions**

## Implementation

### Step 1: Add all proxy actions to `supabase/functions/gohighlevel/index.ts`
Add 27 new switch cases for each action above. Straightforward pattern matching the existing code.

### Step 2: Add AI tools to `supabase/functions/chat/index.ts`
Add ~27 new tool definitions and execution handlers so the AI can use them:
- `ghl_list_social_accounts`, `ghl_list_social_posts`, `ghl_create_social_post`, `ghl_delete_social_post`
- `ghl_list_products`, `ghl_get_product`, `ghl_create_product`, `ghl_update_product`, `ghl_delete_product`
- `ghl_list_courses`
- `ghl_list_surveys`, `ghl_get_survey_submissions`
- `ghl_list_blog_posts`, `ghl_create_blog_post`
- `ghl_list_media_files`
- `ghl_list_companies`, `ghl_get_company`
- `ghl_list_links`, `ghl_create_link`
- `ghl_list_businesses`, `ghl_get_business`

### Step 3: Update intent detection keywords
Add keyword groups for: social media/posts, products/store, courses/training, surveys, blogs/articles, media/files, companies, links, businesses.

## Files Changed
- **`supabase/functions/gohighlevel/index.ts`** -- Add 27 new proxy cases
- **`supabase/functions/chat/index.ts`** -- Add 27 tool definitions, execution handlers, and detection keywords

## What Stays the Same
- All existing Tier 1 and Tier 2 tools remain untouched
- No database or frontend changes needed

