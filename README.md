# The Official Realty Group Website

A professional, luxury real estate website for The Official Realty Group, serving Southern Georgian Bay, Ontario, Canada.

## Project Overview

This is a fully static, responsive website built with modern HTML, CSS, and JavaScript. It showcases properties across five communities in Southern Georgian Bay and provides comprehensive real estate services for buyers and sellers.

**Agent:** Jonathan Wallace  
**Service Area:** Southern Georgian Bay (Midland, Penetanguishene, Tiny Township, Tay Township, Wasaga Beach)  
**Tagline:** Your Georgian Bay Real Estate Experts

## Agent Command Center

The Railway backend includes a private agent dashboard at `/dashboard?key=API_KEY`
that aggregates daily tasks, email triage, Follow-Up Boss CRM follow-ups,
calendar, closings + P&L, personal tasks, workouts, meal prep, and marketing —
all in one browser page. Make.com scenarios push live data in from Gmail,
Follow-Up Boss, and Google Calendar; Claude processes agent tasks on Railway.

See [`backend/DASHBOARD.md`](backend/DASHBOARD.md) for full setup, API docs,
and Make.com scenario templates.

## File Structure

```
jonathanwallace.ca/
├── index.html                 # Homepage
├── buyers.html               # Buyers guide page
├── sellers.html              # Sellers guide page
├── about.html                # About the agency page
├── contact.html              # Contact page with form
├── communities/
│   ├── midland.html
│   ├── penetanguishene.html
│   ├── tiny-township.html
│   ├── tay-township.html
│   └── wasaga-beach.html
├── css/
│   ├── style.css            # Main stylesheet
│   ├── forms.css            # Form-specific styles
│   └── communities.css      # Community page styles
├── js/
│   └── main.js              # JavaScript for navigation & forms
├── netlify.toml             # Netlify configuration
├── .gitignore               # Git ignore file
└── README.md                # This file
```

## Features

### Design
- Dark luxury aesthetic with warm gold accents
- Fully responsive design (mobile-first approach)
- Professional, high-end real estate look
- Smooth animations and transitions
- Accessible navigation with dropdown menus

### Pages
- **Homepage:** Hero section, about, service cards, community grid, testimonials, listings placeholder, contact form
- **Buyers Guide:** Comprehensive guide to buying in Georgian Bay
- **Sellers Guide:** Strategic selling tips and market information
- **About Page:** Agency story, values, and mission
- **Contact Page:** Full contact form with validation, FAQ section
- **Community Pages:** Individual pages for each of 5 communities with unique content

### Functionality
- Mobile responsive navigation with hamburger menu
- Contact form with validation and honeypot protection
- Smooth scroll animations
- Clean URL routing via netlify.toml
- External link handling (opens in new tab)
- Form data sends to Make.com webhook (URL needs to be configured)

## Setup & Deployment

### Prerequisites
- Git
- GitHub account
- Netlify account

### Local Development
1. Clone the repository
2. Open `index.html` in a browser
3. Use a local server if needed: `python -m http.server 8000`

### Deployment to Netlify
1. Push code to GitHub
2. Connect GitHub repo to Netlify
3. Netlify will automatically build and deploy
4. Update Make.com webhook URL in `js/main.js` for contact form

## Customization

### Colors
Edit color variables in `css/style.css`:
- `--primary-dark: #0a1628` - Main background
- `--accent-gold: #c9a96e` - Accent color
- `--text-light: #f5f5f5` - Light text

### Contact Form Webhook
Update the webhook URL in `js/main.js` line 68:
```javascript
const webhookUrl = 'https://hook.make.com/YOUR_WEBHOOK_ID';
```

### Phone Number & Email
Update contact information in:
- Navigation: `navbar` section
- Footer: `footer` section
- Contact page: contact information boxes

### Community Information
Each community page is fully customizable with:
- Unique descriptions and highlights
- Local attractions and features
- Market characteristics
- Why live here sections

## Browser Support
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance
- Optimized CSS and JavaScript
- Image lazy loading support
- Cached assets via Netlify headers
- Minified and compressed assets

## Security
- Security headers configured in netlify.toml
- Honeypot field for form spam protection
- Email and phone validation
- No sensitive data stored client-side

## Contact & Support
For questions or modifications to the website, contact Jonathan Wallace:
- Phone: +1 (519) 555-1234
- Email: jonathanwallacerealestate@gmail.com

---

Built with HTML, CSS, and JavaScript. Hosted on Netlify. Data powered by Ruuster and MLS.
