import os
import subprocess

assets_dir = '/Users/jack/work/外包/仕舟/assets/images'
os.makedirs(assets_dir, exist_ok=True)

# 1. 仕舟 Logo (Beautiful layered boat/education SVG)
logo_svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563EB" />
      <stop offset="100%" stop-color="#10B981" />
    </linearGradient>
    <linearGradient id="boat" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#f0fdf4" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-opacity="0.15" />
    </filter>
  </defs>
  <!-- Background with soft rounded rectangle -->
  <rect width="400" height="400" rx="90" fill="url(#bg)" />
  
  <!-- Stylized Boat/Book/Education Icon -->
  <g transform="translate(60, 80)" filter="url(#shadow)">
    <!-- Main sail / Open book page -->
    <path d="M140 20 C80 60 40 120 40 200 L140 220 Z" fill="url(#boat)" opacity="0.95"/>
    <!-- Secondary sail -->
    <path d="M160 40 C200 80 240 140 240 200 L160 210 Z" fill="url(#boat)" opacity="0.85"/>
    <!-- Boat hull / Pen nib base -->
    <path d="M30 240 Q140 280 250 240 L220 280 Q140 310 60 280 Z" fill="#ffffff"/>
    
    <!-- Sun / Goal indicator -->
    <circle cx="220" cy="80" r="24" fill="#FDE68A" />
  </g>
</svg>'''

# 2. Default Premium Avatar (Clean, modern user placeholder)
avatar_svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#EFF6FF" />
      <stop offset="100%" stop-color="#DBEAFE" />
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#grad)" />
  <!-- Shoulders -->
  <path d="M40 200 C40 140 70 110 100 110 C130 110 160 140 160 200 Z" fill="#93C5FD"/>
  <!-- Head -->
  <circle cx="100" cy="75" r="35" fill="#BFDBFE"/>
</svg>'''

images = {
    'logo.svg': logo_svg,
    'default-avatar.svg': avatar_svg
}

for name, content in images.items():
    svg_path = os.path.join(assets_dir, name)
    png_path = svg_path.replace('.svg', '.png')
    
    with open(svg_path, 'w') as f:
        f.write(content)
        
    # Convert and scale
    subprocess.run(['sips', '-s', 'format', 'png', svg_path, '--out', png_path], capture_output=True)
    os.remove(svg_path)

print("Premium Logo and Avatar generated!")
