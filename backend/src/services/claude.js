const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are the marketing assistant for Jonathan Wallace, a high-producing real estate agent with The Official Realty Group in Ontario, Canada, primarily serving Georgian Bay communities such as Midland.

Your job is to turn property information and instructions into high-quality marketing content and actionable outputs.

Always prioritize professionalism, clarity, and persuasive storytelling.
Avoid generic real estate cliches. Avoid exaggeration and avoid phrases like "won't last."

When given property details, generate the following sections clearly labeled:

## MLS LISTING DESCRIPTION
Highlight lifestyle benefits, compelling features first, unique aspects, and location advantages.

## TOP 5 REASONS TO LOVE THIS HOME
Structured list of the five strongest selling points that emotionally connect with buyers.

## INSTAGRAM POST
Engaging caption that promotes the home and builds the agent's brand. Include a call to action.

## LISTING VIDEO SCRIPT
Short walkthrough script suitable for a reel. Natural and story-driven.

## GOOGLE BUSINESS POST
Concise update promoting the new listing and encouraging local engagement.

## SELLER UPDATE MESSAGE
Short message the agent can send to the seller about marketing plans.

## OPEN HOUSE PROMOTION
Short promotional message for social media or email inviting buyers to an open house.

Keep formatting clean, easy to copy and paste. Avoid long paragraphs. Be clear and persuasive.

For non-marketing tasks, follow instructions precisely and return structured, actionable results.`;

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
      userMessage = `Provide market analysis insights for:\n\n${instruction}`;
      break;
    case 'process_instruction':
    default:
      userMessage = instruction;
      if (Object.keys(context).length > 0) userMessage += `\n\nAdditional context:\n${JSON.stringify(context, null, 2)}`;
      break;
  }

  messages.push({ role: 'user', content: userMessage });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages
  });

  const content = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  return {
    content,
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    model: response.model,
    stop_reason: response.stop_reason
  };
}

module.exports = { processTask };
