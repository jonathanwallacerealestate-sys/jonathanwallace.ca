/**
 * The Official Realty Group - Main JavaScript
 * Handles navigation, forms, and interactions
 */

// ===== MOBILE NAVIGATION TOGGLE =====
document.addEventListener('DOMContentLoaded', function() {
    const mobileToggle = document.getElementById('mobileToggle');
    const navMenu = document.getElementById('navMenu');

    if (mobileToggle) {
        mobileToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            // Animate hamburger
            this.classList.toggle('active');
        });
    }

    // Close menu when a link is clicked
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            navMenu.classList.remove('active');
            if (mobileToggle) {
                mobileToggle.classList.remove('active');
            }
        });
    });

    // Handle dropdown on mobile
    const dropdownToggles = document.querySelectorAll('.dropdown-toggle');
    dropdownToggles.forEach(toggle => {
        toggle.addEventListener('click', function(e) {
            if (window.innerWidth <= 768) {
                e.preventDefault();
                const dropdown = this.nextElementSibling;
                dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            }
        });
    });

    // ===== CONTACT FORM HANDLING =====
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', handleFormSubmit);
    }

    // ===== SMOOTH SCROLLING =====
    setupSmoothScrolling();

    // ===== SCROLL ANIMATIONS =====
    setupScrollAnimations();
});

/**
 * Handle contact form submission
 */
function handleFormSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const honeypot = form.querySelector('input[name="website"]');

    // Basic honeypot check
    if (honeypot.value) {
        console.log('Honeypot triggered - form submission blocked');
        return;
    }

    // Get form data
    const formData = {
        firstName: form.querySelector('#firstName').value,
        lastName: form.querySelector('#lastName')?.value || '',
        email: form.querySelector('#email').value,
        phone: form.querySelector('#phone').value,
        type: form.querySelector('#type').value,
        community: form.querySelector('#community')?.value || '',
        message: form.querySelector('#message').value,
        timestamp: new Date().toISOString(),
        source: window.location.pathname
    };

    // Validate required fields
    if (!formData.firstName || !formData.email || !formData.phone || !formData.type || !formData.message) {
        alert('Please fill in all required fields.');
        return;
    }

    // Email validation
    if (!isValidEmail(formData.email)) {
        alert('Please enter a valid email address.');
        return;
    }

    // Phone validation (basic)
    if (!isValidPhone(formData.phone)) {
        alert('Please enter a valid phone number.');
        return;
    }

    // Send to webhook (update this URL to your Make.com webhook)
    sendToWebhook(formData);
}

/**
 * Send form data to Make.com webhook
 */
function sendToWebhook(data) {
    const webhookUrl = 'https://hook.make.com/YOUR_WEBHOOK_ID'; // Replace with actual webhook URL

    // Show loading state
    const submitBtn = document.querySelector('.submit-btn');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Sending...';
    submitBtn.disabled = true;

    // Send data using fetch
    fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    })
    .then(response => {
        if (response.ok) {
            // Success
            alert('Thank you! Your message has been sent. We\'ll get back to you soon!');
            document.getElementById('contactForm').reset();
            submitBtn.textContent = 'Message Sent!';
            setTimeout(() => {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }, 2000);
        } else {
            throw new Error('Network response was not ok');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('There was an error sending your message. Please try again or call us directly.');
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    });
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate phone format (basic check)
 */
function isValidPhone(phone) {
    // Remove non-digit characters
    const digitsOnly = phone.replace(/\D/g, '');
    // Check if we have at least 10 digits
    return digitsOnly.length >= 10;
}

/**
 * Setup smooth scrolling for anchor links
 */
function setupSmoothScrolling() {
    const links = document.querySelectorAll('a[href^="#"]');

    links.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');

            // Skip if href is just "#"
            if (href === '#') return;

            const target = document.querySelector(href);

            if (target) {
                e.preventDefault();
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

/**
 * Setup scroll animations
 * Adds animation classes to elements as they come into view
 */
function setupScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe cards and sections for animation
    const animatedElements = document.querySelectorAll('.card, .community-card, .testimonial, .value-item');
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

/**
 * Handle window resize for responsive navigation
 */
window.addEventListener('resize', function() {
    const navMenu = document.getElementById('navMenu');
    const mobileToggle = document.getElementById('mobileToggle');

    if (window.innerWidth > 768) {
        navMenu.classList.remove('active');
        if (mobileToggle) {
            mobileToggle.classList.remove('active');
        }
    }
});

/**
 * Utility function to add class to active nav link based on current page
 */
function updateActiveNavLink() {
    const currentPage = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && (currentPage === href || currentPage === href + '.html' || currentPage.includes(href))) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// Call on page load
updateActiveNavLink();

/**
 * Handle form input validation for better UX
 */
document.addEventListener('change', function(e) {
    if (e.target.type === 'email') {
        if (!isValidEmail(e.target.value) && e.target.value) {
            e.target.style.borderColor = '#c9a96e';
        } else {
            e.target.style.borderColor = '';
        }
    }

    if (e.target.type === 'tel') {
        if (!isValidPhone(e.target.value) && e.target.value) {
            e.target.style.borderColor = '#c9a96e';
        } else {
            e.target.style.borderColor = '';
        }
    }
});

/**
 * Add active state to form inputs when focused
 */
document.addEventListener('focus', function(e) {
    if (e.target.matches('input, textarea, select')) {
        e.target.style.borderColor = '#c9a96e';
    }
}, true);

document.addEventListener('blur', function(e) {
    if (e.target.matches('input, textarea, select')) {
        if (e.target.value === '') {
            e.target.style.borderColor = '';
        }
    }
}, true);

/**
 * Preload images for better performance
 */
function preloadImages() {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        const imageUrl = img.getAttribute('src');
        if (imageUrl) {
            const preloadImg = new Image();
            preloadImg.src = imageUrl;
        }
    });
}

// Preload images on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preloadImages);
} else {
    preloadImages();
}

/**
 * Log page metrics (optional - for analytics)
 */
function logPageMetrics() {
    const pageInfo = {
        title: document.title,
        path: window.location.pathname,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent.substring(0, 50)
    };

    console.log('Page loaded:', pageInfo);
}

logPageMetrics();

/**
 * Handle external links (opens in new tab)
 */
document.addEventListener('click', function(e) {
    if (e.target.tagName === 'A' && e.target.hostname !== window.location.hostname) {
        if (!e.target.hasAttribute('target')) {
            e.target.setAttribute('target', '_blank');
            e.target.setAttribute('rel', 'noopener noreferrer');
        }
    }
});
