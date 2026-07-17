import os
import subprocess

icons_data = {
    # Home
    'home.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#666666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>',
    'home-active.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2563EB"><path d="M12 3L20 9V21A1 1 0 0 1 19 22H15V14H9V22H5A1 1 0 0 1 4 21V9L12 3Z"></path></svg>',
    
    # Share / Gift
    'share.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#666666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path></svg>',
    'share-active.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2563EB"><path d="M19 12H5V21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9zm-8 10v-8h2v8h-2zM21 7v4H3V7h18zm-9 0c0-1.89-1-4-3.5-4C6.55 3 6 4.75 8.04 6.72L12 7zm0 0c0-1.89 1-4 3.5-4C17.45 3 18 4.75 15.96 6.72L12 7z"/></svg>',

    # Supervision (Group/Target)
    'supervision.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#666666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    'supervision-active.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2563EB"><path d="M13 14a5 5 0 0 1-8 0 5 5 0 0 1 8 0zM12 15.5c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zM24 19.5v-2c0-2.22-3.58-3.51-6.46-3.88.92.83 1.46 2.05 1.46 3.38v2.5H24zM16 14a5 5 0 0 1-5-5 5 5 0 0 1 5 5z"/></svg>',

    # Message
    'message.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#666666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>',
    'message-active.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2563EB"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>',

    # Profile
    'profile.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#666666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
    'profile-active.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2563EB"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
}

icons_dir = '/Users/jack/work/外包/仕舟/assets/icons'
os.makedirs(icons_dir, exist_ok=True)

for name, svg_str in icons_data.items():
    svg_path = os.path.join(icons_dir, name)
    png_path = svg_path.replace('.svg', '.png')
    
    # Write SVG
    with open(svg_path, 'w') as f:
        f.write(svg_str)
        
    # Convert using sips (81x81 recommended by WeChat)
    # sips -z 81 81 works well for scaling
    subprocess.run(['sips', '-z', '81', '81', '-s', 'format', 'png', svg_path, '--out', png_path], capture_output=True)

print("Icons successfully generated using sips (both SVG and PNG kept).")
