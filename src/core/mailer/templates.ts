export function forgotPasswordHtml(otp: string, expiresInMin: number): string {
  const currentYear = new Date().getFullYear();
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Verification - Shivansh Infosys</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', sans-serif;
            line-height: 1.6;
            color: #374151;
            background-color: #f9fafb;
            margin: 0;
            padding: 20px;
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        
        .header {
            background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
            padding: 30px 20px;
            text-align: center;
        }
        
        .logo-container {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            text-decoration: none;
        }
        
        .logo-icon {
            width: 40px;
            height: 40px;
        }
        
        .logo-text {
            text-align: left;
        }
        
        .brand-name {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: 700;
            line-height: 1.2;
        }
        
        .brand-red {
            color: #dc2626;
        }
        
        .white {
            color: #fec9c9ff;
            margin-left: 4px;
        }
        
        .tagline {
            font-size: 12px;
            color: #d1d5db;
            margin-top: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        }
        
        .content {
            padding: 40px 30px;
        }
        
        .title {
            font-size: 24px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 20px;
            text-align: center;
        }
        
        .message {
            font-size: 16px;
            color: #4b5563;
            margin-bottom: 30px;
            text-align: center;
            line-height: 1.7;
        }
        
        .otp-container {
            text-align: center;
            margin: 40px 0;
        }
        
        .otp-code {
            display: inline-block;
            font-size: 42px;
            font-weight: 700;
            color: #dc2626;
            letter-spacing: 6px;
            background-color: #fef2f2;
            padding: 20px 30px;
            border-radius: 12px;
            border: 2px dashed #fca5a5;
            font-family: 'Courier New', monospace;
            margin-bottom: 20px;
            min-width: 250px;
        }
        
        .expiry-notice {
            text-align: center;
            color: #6b7280;
            font-size: 14px;
            margin-top: 10px;
            padding: 12px 20px;
            background-color: #f3f4f6;
            border-radius: 8px;
            display: inline-block;
            font-weight: 500;
        }
        
        .warning-box {
            background-color: #fffbeb;
            border: 1px solid #f59e0b;
            border-left: 4px solid #f59e0b;
            padding: 20px;
            margin: 30px 0;
            border-radius: 8px;
        }
        
        .warning-title {
            color: #92400e;
            font-weight: 600;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .warning-text {
            color: #78350f;
            font-size: 14px;
            line-height: 1.6;
        }
        
        .footer {
            background-color: #f9fafb;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
        }
        
        .company-info {
            color: #6b7280;
            font-size: 14px;
            margin-bottom: 15px;
            line-height: 1.5;
        }
        
        .contact-info {
            color: #4b5563;
            font-size: 14px;
            margin-bottom: 15px;
        }
        
        .copyright {
            color: #9ca3af;
            font-size: 12px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
        }
        
        .help-text {
            font-size: 14px;
            color: #6b7280;
            text-align: center;
            margin-top: 30px;
            padding: 15px;
            background-color: #f8fafc;
            border-radius: 8px;
        }
        
        @media only screen and (max-width: 600px) {
            body {
                padding: 10px;
            }
            
            .content {
                padding: 30px 20px;
            }
            
            .otp-code {
                font-size: 32px;
                letter-spacing: 4px;
                padding: 15px 20px;
                min-width: 200px;
            }
            
            .brand-name {
                font-size: 20px;
            }
            
            .title {
                font-size: 22px;
            }
            
            .message {
                font-size: 15px;
            }
            
            .footer {
                padding: 20px;
            }
        }
        
        @media only screen and (max-width: 400px) {
            .otp-code {
                font-size: 28px;
                letter-spacing: 3px;
                padding: 12px 15px;
            }
            
            .brand-name {
                flex-direction: column;
                gap: 0;
            }
            
            .white {
                margin-left: 0;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <!-- Header with Logo -->
        <div class="header">
            <div class="logo-container">
                <div class="logo-text">
                    <div class="brand-name">
                        <span class="brand-red">SHIVANSH</span>
                        <span class="white">INFOSYS</span>
                    </div>
                    <div class="tagline">
                        <span>Quick Response</span>
                        <span>-</span>
                        <span>Quick Support</span>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Main Content -->
        <div class="content">
            <h1 class="title">Password Reset OTP</h1>
            
            <p class="message">
                We received a request to reset your password. Use the OTP below to verify your identity and proceed with resetting your password.
            </p>
            
            <!-- OTP Display -->
            <div class="otp-container">
                <div class="otp-code">${otp}</div>
                <div class="expiry-notice">
                    ⏰ This OTP will expire in ${expiresInMin} minutes
                </div>
            </div>
            
            <!-- Security Warning -->
            <div class="warning-box">
                <div class="warning-title">
                    <span>⚠️</span>
                    <span>Security Notice</span>
                </div>
                <div class="warning-text">
                    • Do not share this OTP with anyone<br>
                    • Shivansh Infosys will never ask for your OTP<br>
                    • If you didn't request this OTP, please ignore this email<br>
                    • For security reasons, this OTP will expire automatically
                </div>
            </div>
            
            <div class="help-text">
                Need help? Contact our support team for assistance.
            </div>
        </div>
        
        <!-- Footer -->
        <div class="footer">
            <div class="company-info">
                <strong>Shivansh Infosys</strong><br>
                Quick Response - Quick Support
            </div>
            
            <div class="contact-info">
                <a href="https://shivanshinfosys.in/" style="color: #dc2626; text-decoration: none; font-weight: 500;">
                    shivanshinfosys.in
                </a>
            </div>
            
            <div class="copyright">
                © ${currentYear} Shivansh Infosys. All rights reserved.
            </div>
        </div>
    </div>
</body>
</html>`;
}


export function welcomeEmployeeHtml(
  firstName: string,
  email: string,
  username: string,
  tempPassword: string,
  loginUrl: string
): string {
  const currentYear = new Date().getFullYear();
  const supportEmail = "support@shivanshinfosys.in";
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Shivansh Infosys - Your Account Details</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', sans-serif;
            line-height: 1.6;
            color: #374151;
            background-color: #f9fafb;
            margin: 0;
            padding: 20px;
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        
        .header {
            background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
            padding: 40px 20px;
            text-align: center;
        }
        
        .welcome-icon {
            font-size: 48px;
            color: #ffffff;
            margin-bottom: 20px;
        }
        
        .logo-text {
            text-align: center;
        }
        
        .brand-name {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: 700;
            line-height: 1.2;
            margin-bottom: 8px;
        }
        
        .brand-red {
            color: #dc2626;
        }
        
        .white {
            color: #fec9c9ff;
            margin-left: 4px;
        }
        
        .tagline {
            font-size: 14px;
            color: #d1d5db;
            margin-top: 4px;
        }
        
        .content {
            padding: 40px 30px;
        }
        
        .welcome-title {
            font-size: 28px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 16px;
            text-align: center;
        }
        
        .greeting {
            font-size: 18px;
            color: #4b5563;
            margin-bottom: 30px;
            text-align: center;
            line-height: 1.7;
        }
        
        .account-details {
            background-color: #f8fafc;
            border-radius: 10px;
            padding: 25px;
            margin: 30px 0;
            border-left: 4px solid #dc2626;
        }
        
        .details-title {
            color: #111827;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .detail-row {
            display: flex;
            align-items: flex-start;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .detail-row:last-child {
            border-bottom: none;
            margin-bottom: 0;
            padding-bottom: 0;
        }
        
        .detail-label {
            font-weight: 600;
            color: #374151;
            min-width: 120px;
            font-size: 14px;
        }
        
        .detail-value {
            flex: 1;
            color: #111827;
            font-size: 15px;
            word-break: break-all;
        }
        
        .highlight {
            background-color: #fef2f2;
            color: #dc2626;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
            font-family: 'Courier New', monospace;
        }
        
        .important-box {
            background-color: #fffbeb;
            border: 1px solid #f59e0b;
            border-left: 4px solid #f59e0b;
            padding: 20px;
            margin: 30px 0;
            border-radius: 8px;
        }
        
        .important-title {
            color: #92400e;
            font-weight: 600;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .important-text {
            color: #78350f;
            font-size: 14px;
            line-height: 1.6;
        }
        
        .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
            color: white;
            text-decoration: none;
            padding: 14px 32px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            text-align: center;
            margin: 30px auto;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
        }
        
        .cta-button:hover {
            background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);
        }
        
        .login-url {
            text-align: center;
            margin: 15px 0;
            font-size: 14px;
            color: #6b7280;
            word-break: break-all;
            padding: 10px;
            background-color: #f3f4f6;
            border-radius: 6px;
        }
        
        .footer {
            background-color: #f9fafb;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
        }
        
        .company-info {
            color: #6b7280;
            font-size: 14px;
            margin-bottom: 15px;
            line-height: 1.5;
        }
        
        .support-info {
            color: #4b5563;
            font-size: 14px;
            margin: 15px 0;
            padding: 15px;
            background-color: #f1f5f9;
            border-radius: 8px;
        }
        
        .copyright {
            color: #9ca3af;
            font-size: 12px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
        }
        
        @media only screen and (max-width: 600px) {
            body {
                padding: 10px;
            }
            
            .content {
                padding: 30px 20px;
            }
            
            .brand-name {
                font-size: 22px;
            }
            
            .welcome-title {
                font-size: 24px;
            }
            
            .detail-row {
                flex-direction: column;
                gap: 5px;
            }
            
            .detail-label {
                min-width: auto;
            }
            
            .cta-button {
                display: block;
                width: 100%;
                padding: 16px;
            }
            
            .footer {
                padding: 20px;
            }
        }
        
        @media only screen and (max-width: 400px) {
            .brand-name {
                flex-direction: column;
                gap: 0;
            }
            
            .white {
                margin-left: 0;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <!-- Header -->
        <div class="header">
            <div class="welcome-icon">🎉</div>
            <div class="logo-text">
                <div class="brand-name">
                    <span class="brand-red">SHIVANSH</span>
                    <span class="white">INFOSYS</span>
                </div>
                <div class="tagline">
                    Quick Response - Quick Support
                </div>
            </div>
        </div>
        
        <!-- Main Content -->
        <div class="content">
            <h1 class="welcome-title">Welcome to the Team, ${firstName}!</h1>
            
            <p class="greeting">
                We're excited to have you join Shivansh Infosys. Your account has been successfully created and is ready for use.
            </p>
            
            <!-- Account Details -->
            <div class="account-details">
                <div class="details-title">
                    <span>🔐</span>
                    <span>Your Account Credentials</span>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Email:</div>
                    <div class="detail-value">${email}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Username:</div>
                    <div class="detail-value">${username}</div>
                </div>
                
                <div class="detail-row">
                    <div class="detail-label">Temporary Password:</div>
                    <div class="detail-value">
                        <span class="highlight">${tempPassword}</span>
                    </div>
                </div>
            </div>
            
            <!-- Important Notice -->
            <div class="important-box">
                <div class="important-title">
                    <span>⚠️</span>
                    <span>Important Security Notice</span>
                </div>
                <div class="important-text">
                    • Please change your password immediately after your first login<br>
                    • Do not share your credentials with anyone<br>
                    • Use a strong, unique password for your account<br>
                    • If you suspect any unauthorized access, contact IT support immediately
                </div>
            </div>
            
            <!-- Call to Action -->
            <div style="text-align: center;">
                <a href="${loginUrl}" class="cta-button">
                    Login to Your Account
                </a>
                
                <div class="login-url">
                    Login URL: <a href="${loginUrl}" style="color: #dc2626;">${loginUrl}</a>
                </div>
            </div>
            
            <!-- Additional Information -->
            <div class="support-info">
                <strong>Need Help?</strong><br>
                If you encounter any issues logging in or have questions about your account, please contact our support team at:<br>
                <a href="mailto:${supportEmail}" style="color: #dc2626; text-decoration: none;">${supportEmail}</a>
            </div>
        </div>
        
        <!-- Footer -->
        <div class="footer">
            <div class="company-info">
                <strong>Shivansh Infosys</strong><br>
                Empowering businesses with technology solutions
            </div>
            
            <div class="copyright">
                © ${currentYear} Shivansh Infosys. All rights reserved.
            </div>
        </div>
    </div>
</body>
</html>`;
}


export function forgotPasswordText(otp: string, expiresInMin: number): string {
  return `Your password reset code for Shivansh Infosys: ${otp}

This code will expire in ${expiresInMin} minutes.

If you did not request this password reset, please ignore this email.`;
}
