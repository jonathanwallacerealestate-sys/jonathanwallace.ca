const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

const anthropic = new Anthropic();

// Gmail API setup using OAuth2 refresh token
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

const SYSTEM_PROMPT = `You are the marketing assistant for Jonathan Wallace, a high-producing real estate agent with The Official Realty Group in Ontario, Canada, primarily serving Georgian Bay communities such as Midland, Penetanguishene, Tiny Township, Wasaga Beach, and Collingwood.

Your job is to turn property information and instructions into high-quality marketing content and actionable outputs.

Always prioritize professionalism, clarity, and persuasive storytelling.
Avoid generic real estate cliches. Avoid exaggeration and avoid phrases like "won't last."

When given property details, generate the following sections clearly labeled:

## MLS LISTING DESCRIPTION
Highlight lifestyle benefits, compelling features first, unique aspects, and location advantages.

## TOP 5 REASONS TO LOVE THIS HOME
Structured list of the five strongest selling points that emotionally connect with buyers.

## INSTAGRAM POST
Engaging caption that promotes the home and builds the agent's brand. Include a call to action and suggest relevant hashtags.

## LISTING VIDEO SCRIPT
Short walkthrough script suitable for a reel. Natural and story-driven.

## GOOGLE BUSINESS POST
Concise update promoting the new listing and encouraging local engagement.

## SELLER UPDATE MESSAGE
Short message the agent can send to the seller about marketing plans.

## OPEN HOUSE PROMOTION
Short promotional message for social media or email inviting buyers to an open house.

Keep formatting clean, easy to copy and paste. Avoid long paragraphs. Be clear and persuasive.

For non-marketing tasks, follow instructions precisely and return structured, actionable results.

You have access to tools that let you take real actions: send emails, create calendar events, search calendars, and create email drafts. Use these tools when the user's instruction requires taking an action beyond generating text. Always confirm what action you are taking in your response.`;

// Tool definitions for Claude's native tool_use
const TOOLS = [
  {
    name: 'send_email',
    description: 'Send an email from Jonathan Wallace\'s Gmail account (jonathanwallacerealestate@gmail.com). Use this when instructed to email someone.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (HTML supported)' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'create_email_draft',
    description: 'Create an email draft in Jonathan\'s Gmail for review before sending. Use this when the user wants to draft but not immediately send.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (HTML supported)' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'create_calendar_event',
    description: 'Create an event on Jonathan\'s Google Calendar. Use this for scheduling showings, open houses, meetings, etc.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start_time: { type: 'string', description: 'Start time in ISO 8601 format (e.g. 2026-04-20T14:00:00-04:00)' },
        end_time: { type: 'string', description: 'End time in ISO 8601 format' },
        description: { type: 'string', description: 'Event description/notes' },
        location: { type: 'string', description: 'Event location/address' }
      },
      required: ['title', 'start_time', 'end_time']
    }
  },
  {
    name: 'list_calendar_events',
    description: 'Search and list events on Jonathan\'s Google Calendar within a date range. Use this to check availability or find scheduled showings.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to filter events (optional)' },
        start_date: { type: 'string', description: 'Start of date range in ISO 8601 format' },
        end_date: { type: 'string', description: 'End of date range in ISO 8601 format' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'search_google_drive',
    description: 'Search for files and folders in Jonathan\'s Google Drive. Use this to find listing photos, documents, contracts, etc. Note: This connector requires a Google Drive connection to be configured.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for files/folders (e.g. "123 Main St photos")' }
      },
      required: ['query']
    }
  }
];

// Make.com webhook for calendar/drive tools only
const CALENDAR_WEBHOOK_URL = 'https://hook.us2.make.com/4bppiq7augsxhykycje1tvw1f4bv5lsr';

const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;
const MAX_TOOL_ROUNDS = 5;

// Build a raw RFC 2822 email message
function buildRawEmail({ to, subject, body }) {
  const from = process.env.GMAIL_USER || 'jonathanwallacerealestate@gmail.com';
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    body
  ];
  const message = messageParts.join('\r\n');
  return Buffer.from(message).toString('base64url');
}

// Execute email tools directly via Gmail API
async function executeGmailTool(toolName, toolInput) {
  if (toolName === 'send_email') {
    const raw = buildRawEmail(toolInput);
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });
    return { success: true, messageId: res.data.id, threadId: res.data.threadId };
  }

  if (toolName === 'create_email_draft') {
    const raw = buildRawEmail(toolInput);
    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } }
    });
    return { success: true, draftId: res.data.id, messageId: res.data.message.id };
  }

  throw new Error(`Unknown Gmail tool: ${toolName}`);
}

// Execute calendar/drive tools via Make.com webhook
async function executeMakeWebhook(toolName, toolInput) {
  const response = await fetch(CALENDAR_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: toolName, action_params: toolInput })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { error: true, message: `Connector returned ${response.status}: ${errorText}` };
  }

  return await response.json();
}

const EMAIL_TOOLS = ['send_email', 'create_email_draft'];

async function executeToolCall(toolName, toolInput) {
  try {
    if (EMAIL_TOOLS.includes(toolName)) {
      console.log(`[Claude] Routing ${toolName} via Gmail API directly`);
      return await executeGmailTool(toolName, toolInput);
    } else {
      console.log(`[Claude] Routing ${toolName} via Make.com calendar gateway`);
      return await executeMakeWebhook(toolName, toolInput);
    }
  } catch (err) {
    console.error(`[Claude] Tool execution error for ${toolName}:`, err.message);
    return { error: true, message: `Tool call failed: ${err.message}` };
  }
}

async function processTask(taskType, instruction, context = {}) {
  const messages = [];
  let userMessage = '';

  switch (taskType) {
    case 'generate_marketing':
      userMessage = `Generate a complete marketing package for this property:\n\n${instruction}`;
      if (context.listing) userMessage += `\n\nExisting listing data:\n${JSON.stringify(context.listing, null, 2)}`;
      break;

    case 'generate_social':
      userMessage = `Create social media content for this:\n\n${instruction}`;
      if (context.platform) userMessage += `\nTarget platform: ${context.platform}`;
      break;

    case 'update_listing':
      userMessage = `Update the following listing information and return the corrected data as JSON:\n\n${instruction}`;
      if (context.current_listing) userMessage += `\nCurrent listing data:\n${JSON.stringify(context.current_listing, null, 2)}`;
      break;

    case 'generate_email':
      userMessage = `Draft a professional real estate email:\n\n${instruction}`;
      if (context.recipient_type) userMessage += `\nRecipient type: ${context.recipient_type}`;
      break;

    case 'analyze_market':
      userMessage = `Provide market analysis insights for the Georgian Bay / Simcoe County real estate market:\n\n${instruction}`;
      break;

    case 'generate_open_house':
      userMessage = `Create open house promotional materials including social media posts, email invite, and a feature sheet outline:\n\n${instruction}`;
      break;

    case 'generate_video_script':
      userMessage = `Write a compelling property walkthrough video script for a listing video or reel:\n\n${instruction}`;
      break;

    case 'process_instruction':
    default:
      userMessage = instruction;
      if (Object.keys(context).length > 0) userMessage += `\n\nAdditional context:\n${JSON.stringify(context, null, 2)}`;
      break;
  }

  messages.push({ role: 'user', content: userMessage });

  // Agentic tool-use loop
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalContent = '';
  let modelUsed = '';
  let stopReason = '';
  let toolResults = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let lastError;

    // Retry logic for transient API errors
    let response;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[Claude] Retry attempt ${attempt} for ${taskType}`);
          await new Promise(r => setTimeout(r, RETRY_DELAY * attempt));
        }

        response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages
        });

        break; // Success, exit retry loop
      } catch (err) {
        lastError = err;
        if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
          throw err;
        }
        if (attempt === MAX_RETRIES) {
          throw err;
        }
        console.warn(`[Claude] API error (attempt ${attempt + 1}): ${err.message}`);
      }
    }

    if (!response) throw lastError;

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    modelUsed = response.model;
    stopReason = response.stop_reason;

    // If Claude is done (no more tool calls), extract final text
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      finalContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      break;
    }

    // Handle tool_use blocks
    if (response.stop_reason === 'tool_use') {
      // Add Claude's response (with tool_use blocks) to messages
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool call and collect results
      const toolResultBlocks = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`[Claude] Tool call: ${block.name}(${JSON.stringify(block.input).substring(0, 120)})`);
          const result = await executeToolCall(block.name, block.input);
          console.log(`[Claude] Tool result: ${JSON.stringify(result).substring(0, 200)}`);

          toolResults.push({ tool: block.name, input: block.input, result });
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }
      }

      // Add tool results to messages for next round
      messages.push({ role: 'user', content: toolResultBlocks });
      continue;
    }

    // Fallback: extract text if stop reason is something else
    finalContent = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    break;
  }

  return {
    content: finalContent,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens
    },
    model: modelUsed,
    stop_reason: stopReason,
    tool_calls: toolResults.length > 0 ? toolResults : undefined
  };
}

module.exports = { processTask };
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are the marketing assistant for Jonathan Wallace, a high-producing real estate agent with The Official Realty Group in Ontario, Canada, primarily serving Georgian Bay communities such as Midland, Penetanguishene, Tiny Township, Wasaga Beach, and Collingwood.

Your job is to turn property information and instructions into high-quality marketing content and actionable outputs.

Always prioritize professionalism, clarity, and persuasive storytelling.
Avoid generic real estate cliches. Avoid exaggeration and avoid phrases like "won't last."

When given property details, generate the following sections clearly labeled:

## MLS LISTING DESCRIPTION
Highlight lifestyle benefits, compelling features first, unique aspects, and location advantages.

## TOP 5 REASONS TO LOVE THIS HOME
Structured list of the five strongest selling points that emotionally connect with buyers.

## INSTAGRAM POST
Engaging caption that promotes the home and builds the agent's brand. Include a call to action and suggest relevant hashtags.

## LISTING VIDEO SCRIPT
Short walkthrough script suitable for a reel. Natural and story-driven.

## GOOGLE BUSINESS POST
Concise update promoting the new listing and encouraging local engagement.

## SELLER UPDATE MESSAGE
Short message the agent can send to the seller about marketing plans.

## OPEN HOUSE PROMOTION
Short promotional message for social media or email inviting buyers to an open house.

Keep formatting clean, easy to copy and paste. Avoid long paragraphs. Be clear and persuasive.

For non-marketing tasks, follow instructions precisely and return structured, actionable results.

You have access to tools that let you take real actions: send emails, create calendar events, search calendars, and create email drafts. Use these tools when the user's instruction requires taking an action beyond generating text. Always confirm what action you are taking in your response.`;

// Tool definitions for Claude's native tool_use
const TOOLS = [
  {
    name: 'send_email',
    description: 'Send an email from Jonathan Wallace\'s Gmail account (jonathanwallacerealestate@gmail.com). Use this when instructed to email someone.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (HTML supported)' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'create_email_draft',
    description: 'Create an email draft in Jonathan\'s Gmail for review before sending. Use this when the user wants to draft but not immediately send.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (HTML supported)' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'create_calendar_event',
    description: 'Create an event on Jonathan\'s Google Calendar. Use this for scheduling showings, open houses, meetings, etc.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start_time: { type: 'string', description: 'Start time in ISO 8601 format (e.g. 2026-04-20T14:00:00-04:00)' },
        end_time: { type: 'string', description: 'End time in ISO 8601 format' },
        description: { type: 'string', description: 'Event description/notes' },
        location: { type: 'string', description: 'Event location/address' }
      },
      required: ['title', 'start_time', 'end_time']
    }
  },
  {
    name: 'list_calendar_events',
    description: 'Search and list events on Jonathan\'s Google Calendar within a date range. Use this to check availability or find scheduled showings.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to filter events (optional)' },
        start_date: { type: 'string', description: 'Start of date range in ISO 8601 format' },
        end_date: { type: 'string', description: 'End of date range in ISO 8601 format' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'search_google_drive',
    description: 'Search for files and folders in Jonathan\'s Google Drive. Use this to find listing photos, documents, contracts, etc. Note: This connector requires a Google Drive connection to be configured.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for files/folders (e.g. "123 Main St photos")' }
      },
      required: ['query']
    }
  }
];

// Separate webhooks to avoid Make.com module initialization conflicts
const CALENDAR_WEBHOOK_URL = 'https://hook.us2.make.com/4bppiq7augsxhykycje1tvw1f4bv5lsr';
const GMAIL_WEBHOOK_URL = 'https://hook.us2.make.com/uitftxwv23rx0rkgh6c10rdxmzrv3dvb';

const TOOL_WEBHOOK_MAP = {
  'send_email': GMAIL_WEBHOOK_URL,
  'create_email_draft': GMAIL_WEBHOOK_URL,
  'create_calendar_event': CALENDAR_WEBHOOK_URL,
  'list_calendar_events': CALENDAR_WEBHOOK_URL,
  'search_google_drive': CALENDAR_WEBHOOK_URL  // placeholder until Drive scenario exists
};

const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;
const MAX_TOOL_ROUNDS = 5;

async function executeToolCall(toolName, toolInput) {
  try {
    const webhookUrl = TOOL_WEBHOOK_MAP[toolName] || CALENDAR_WEBHOOK_URL;
    console.log(`[Claude] Routing ${toolName} to ${webhookUrl === GMAIL_WEBHOOK_URL ? 'Gmail' : 'Calendar'} gateway`);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: toolName,
        action_params: toolInput
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { error: true, message: `Connector returned ${response.status}: ${errorText}` };
    }

    const result = await response.json();
    return result;
  } catch (err) {
    return { error: true, message: `Connector call failed: ${err.message}` };
  }
}

async function processTask(taskType, instruction, context = {}) {
  const messages = [];
  let userMessage = '';

  switch (taskType) {
    case 'generate_marketing':
      userMessage = `Generate a complete marketing package for this property:\n\n${instruction}`;
      if (context.listing) userMessage += `\n\nExisting listing data:\n${JSON.stringify(context.listing, null, 2)}`;
      break;

    case 'generate_social':
      userMessage = `Create social media content for this:\n\n${instruction}`;
      if (context.platform) userMessage += `\nTarget platform: ${context.platform}`;
      break;

    case 'update_listing':
      userMessage = `Update the following listing information and return the corrected data as JSON:\n\n${instruction}`;
      if (context.current_listing) userMessage += `\nCurrent listing data:\n${JSON.stringify(context.current_listing, null, 2)}`;
      break;

    case 'generate_email':
      userMessage = `Draft a professional real estate email:\n\n${instruction}`;
      if (context.recipient_type) userMessage += `\nRecipient type: ${context.recipient_type}`;
      break;

    case 'analyze_market':
      userMessage = `Provide market analysis insights for the Georgian Bay / Simcoe County real estate market:\n\n${instruction}`;
      break;

    case 'generate_open_house':
      userMessage = `Create open house promotional materials including social media posts, email invite, and a feature sheet outline:\n\n${instruction}`;
      break;

    case 'generate_video_script':
      userMessage = `Write a compelling property walkthrough video script for a listing video or reel:\n\n${instruction}`;
      break;

    case 'process_instruction':
    default:
      userMessage = instruction;
      if (Object.keys(context).length > 0) userMessage += `\n\nAdditional context:\n${JSON.stringify(context, null, 2)}`;
      break;
  }

  messages.push({ role: 'user', content: userMessage });

  // Agentic tool-use loop
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalContent = '';
  let modelUsed = '';
  let stopReason = '';
  let toolResults = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let lastError;

    // Retry logic for transient API errors
    let response;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[Claude] Retry attempt ${attempt} for ${taskType}`);
          await new Promise(r => setTimeout(r, RETRY_DELAY * attempt));
        }

        response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages
        });

        break; // Success, exit retry loop
      } catch (err) {
        lastError = err;
        if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
          throw err;
        }
        if (attempt === MAX_RETRIES) {
          throw err;
        }
        console.warn(`[Claude] API error (attempt ${attempt + 1}): ${err.message}`);
      }
    }

    if (!response) throw lastError;

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    modelUsed = response.model;
    stopReason = response.stop_reason;

    // If Claude is done (no more tool calls), extract final text
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      finalContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      break;
    }

    // Handle tool_use blocks
    if (response.stop_reason === 'tool_use') {
      // Add Claude's response (with tool_use blocks) to messages
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool call and collect results
      const toolResultBlocks = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`[Claude] Tool call: ${block.name}(${JSON.stringify(block.input).substring(0, 120)})`);
          const result = await executeToolCall(block.name, block.input);
          console.log(`[Claude] Tool result: ${JSON.stringify(result).substring(0, 200)}`);

          toolResults.push({ tool: block.name, input: block.input, result });
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }
      }

      // Add tool results to messages for next round
      messages.push({ role: 'user', content: toolResultBlocks });
      continue;
    }

    // Fallback: extract text if stop reason is something else
    finalContent = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    break;
  }

  return {
    content: finalContent,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens
    },
    model: modelUsed,
    stop_reason: stopReason,
    tool_calls: toolResults.length > 0 ? toolResults : undefined
  };
}

module.exports = { processTask };
