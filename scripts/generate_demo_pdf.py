from pathlib import Path
from textwrap import wrap

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas


OUTPUT = Path(__file__).parents[1] / "public" / "demo" / "quiet-reader-demo.pdf"
PAGE_WIDTH, PAGE_HEIGHT = A4
INK = HexColor("#202620")
MUTED = HexColor("#6A726A")
GREEN = HexColor("#28583B")
PALE_GREEN = HexColor("#E5F0E7")
PAPER = HexColor("#FBFBF8")


def draw_wrapped(canvas, text, x, y, width, font="Times-Roman", size=13, leading=21):
    average_char_width = stringWidth("abcdefghijklmnopqrstuvwxyz", font, size) / 26
    characters = max(24, int(width / average_char_width))
    canvas.setFont(font, size)
    canvas.setFillColor(INK)
    for paragraph in text.split("\n\n"):
        for line in wrap(paragraph, width=characters):
            canvas.drawString(x, y, line)
            y -= leading
        y -= leading * 0.65
    return y


def footer(canvas, number):
    canvas.setStrokeColor(HexColor("#D9DDD8"))
    canvas.line(54, 48, PAGE_WIDTH - 54, 48)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(54, 31, "Quiet Reader - demo book")
    canvas.drawRightString(PAGE_WIDTH - 54, 31, str(number))


def chapter(canvas, number, title, key, body, page_number, kicker="A quiet reading practice"):
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.bookmarkPage(key)
    canvas.addOutlineEntry(title, key, 0, False)
    canvas.setFillColor(GREEN)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(54, PAGE_HEIGHT - 68, kicker.upper())
    canvas.setFillColor(INK)
    heading_y = PAGE_HEIGHT - 116
    heading_lines = wrap(f"{number}. {title}", width=31)
    canvas.setFont("Helvetica-Bold", 31)
    for line in heading_lines:
        canvas.drawString(54, heading_y, line)
        heading_y -= 39
    canvas.setStrokeColor(HexColor("#C9D6CB"))
    canvas.line(54, heading_y - 2, PAGE_WIDTH - 54, heading_y - 2)
    draw_wrapped(canvas, body, 54, heading_y - 40, PAGE_WIDTH - 108)
    footer(canvas, page_number)
    canvas.showPage()


def make_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    canvas.setTitle("A Short Guide to Quiet Reading")
    canvas.setAuthor("Quiet Reader")
    canvas.setSubject("A small demonstration PDF for testing Quiet Reader")

    # Cover
    canvas.setFillColor(GREEN)
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.setFillColor(PALE_GREEN)
    canvas.circle(PAGE_WIDTH - 90, PAGE_HEIGHT - 112, 88, fill=1, stroke=0)
    canvas.bookmarkPage("cover")
    canvas.addOutlineEntry("Cover", "cover", 0, False)
    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 16)
    canvas.drawString(56, PAGE_HEIGHT - 84, "QUIET READER")
    canvas.setFont("Times-Bold", 40)
    canvas.drawString(56, PAGE_HEIGHT - 170, "A Short Guide")
    canvas.drawString(56, PAGE_HEIGHT - 218, "to Quiet Reading")
    canvas.setFont("Times-Roman", 18)
    canvas.drawString(56, PAGE_HEIGHT - 270, "A small book for testing focus, search, bookmarks, and notes.")
    canvas.setFont("Helvetica", 11)
    canvas.drawString(56, 70, "Demo edition - made for the Quiet Reader prototype")
    canvas.showPage()

    # Contents
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.bookmarkPage("contents")
    canvas.addOutlineEntry("Contents", "contents", 0, False)
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 30)
    canvas.drawString(54, PAGE_HEIGHT - 84, "Contents")
    entries = [
        ("1. Mark Your Place", "3"),
        ("2. Read in Your Flow", "4"),
        ("3. Notice and Think", "5"),
        ("4. A Small Library", "6"),
        ("5. A Reader That Stays Out of the Way", "7"),
    ]
    y = PAGE_HEIGHT - 150
    for title, page in entries:
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica", 16)
        canvas.drawString(58, y, title)
        canvas.setStrokeColor(HexColor("#BFC7BE"))
        canvas.setDash(2, 4)
        canvas.line(310, y + 3, PAGE_WIDTH - 88, y + 3)
        canvas.setDash()
        canvas.setFillColor(MUTED)
        canvas.drawRightString(PAGE_WIDTH - 58, y, page)
        y -= 54
    footer(canvas, 2)
    canvas.showPage()

    chapter(
        canvas,
        1,
        "Mark Your Place",
        "mark-your-place",
        "A good bookmark is a promise you make to your future self: this is the place that matters next. It should be deliberate, visible, and separate from the page you happened to view last.\n\nUse a main bookmark when you decide a section deserves your attention. Return to it later without losing the natural flow of the pages you visited after it.",
        3,
    )
    chapter(
        canvas,
        2,
        "Read in Your Flow",
        "read-in-your-flow",
        "Continuous reading makes a long document feel like one calm surface. Scroll when you want to wander. Open the table of contents when you want to make a decision.\n\nThe right controls should appear when invited and disappear when they become noise. Reading width and zoom are not decoration: they let a page meet the shape of the device in your hands.",
        4,
    )
    chapter(
        canvas,
        3,
        "Notice and Think",
        "notice-and-think",
        "A note should begin where an idea interrupts you. It does not need folders, tags, feeds, or an audience. It needs a page, a thought, and a reliable place to find that thought again.\n\nSearch is useful when it remains honest. A search result should take you to the right page and leave the matching words highlighted until you decide you are done looking.",
        5,
    )
    chapter(
        canvas,
        4,
        "A Small Library",
        "small-library",
        "A library can be intentionally small. Show only the books you selected, tell you where you last were, and keep the manual bookmark easy to reach.\n\nYour reading history belongs to you. A reader earns trust by saving progress quietly and by never pretending that a last viewed page is the same thing as a chosen destination.",
        6,
    )
    chapter(
        canvas,
        5,
        "A Reader That Stays Out of the Way",
        "stays-out-of-the-way",
        "The best reading interface is present only at the edge of attention. It can offer a bookmark, contents, search, a note, and a view adjustment. Then it gives the page back to you.\n\nThis demo PDF is intentionally short. Try scrolling, opening the contents, searching for bookmark or focus, setting a main mark, and adding a page note. The ideas are small; the reading space is the point.",
        7,
    )
    canvas.save()


if __name__ == "__main__":
    make_pdf()
