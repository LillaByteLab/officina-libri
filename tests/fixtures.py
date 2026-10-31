from pathlib import Path
from PIL import Image, ImageDraw
import sys

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
im = Image.new('RGBA', (5201, 640), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rectangle((100, 80, 5100, 560), fill=(45, 110, 85, 190))
d.ellipse((2200, 110, 2800, 610), fill=(238, 175, 71, 255))
d.line((120, 520, 5000, 140), fill=(255, 255, 255, 240), width=12)
im.save(out/'fixture.png')
im.save(out/'profile-not-supported.png', icc_profile=b'fixture sintetica: profilo da rifiutare')
im.convert('RGB').save(out/'fixture.jpg', quality=94, subsampling=0)
print('Fixture sintetiche PNG RGBA e JPEG: 5201 x 640 px')
