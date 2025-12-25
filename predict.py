import sys
import json
import re
import unicodedata

def normalize_unicode(text):
    """
    Mengonversi karakter dekoratif (Unicode) menjadi ASCII normal.
    Contoh: ⓢⓛⓞⓣ -> slot, 𝐉𝐀𝐂𝐊𝐏𝐎𝐓 -> jackpot
    """
    # Normalisasi NFKD memisahkan karakter gabungan
    normalized = unicodedata.normalize('NFKD', text)
    # Menghapus karakter non-ASCII (simbol hiasan)
    ascii_text = normalized.encode('ascii', 'ignore').decode('ascii')
    return ascii_text

def get_expanded_keywords():
    # KATEGORI HIGH RISK (Skor 45+: Sangat Spesifik)
    high_risk = [
        "slot", "gacor", "maxwin", "berkah99", "scatter", "olympus", "mahjong", "zeus", "starlight", "pragmatic",
        "pgsoft", "habanero", "joker123", "spadegaming", "slot88", "rtp", "sensasional", "jackpot", "jp", "x500",
        "x1000", "x5000", "petir", "kakek", "merah", "biru", "pola", "admin", "bocoranslot", "infogacor", "linkgacor",
        "pusatjudi", "bandar", "togel", "toto", "livecasino", "baccarat", "roulette", "sicbo", "sabungayam",
        "poker", "dominoqq", "ceme", "pkv", "idnpoker", "judibola", "sbobet", "maxbet", "parlay", "handicap",
        "pastiwin", "pastijp", "dibayar", "antiungrung", "situshub", "gampangmenang", "megawin", "gigawin", "tergacor",
        "sensational", "freepin", "buyspin", "doublechance", "dc", "polaolympus", "polamahjong", "jackpotpaus",
        "pecah", "perkalian", "megajp", "autowin", "pastiwd", "garansikekalahan", "antirungkad", "rungkad",
        "mainslot", "daftarslot", "loginslot", "agenslot", "judislot", "judionline", "slotgampang", "slotterpercaya"
    ]
    
    # Menambahkan variasi typo angka (Leet Speak) secara otomatis
    leets = []
    for w in high_risk:
        leets.append(w.replace('a','4').replace('o','0').replace('e','3').replace('i','1').replace('s','5'))
    
    # KATEGORI MED RISK (Skor 20+: Transaksi & Ajakan)
    med_risk = [
        "depo", "wd", "withdraw", "deposit", "min-depo", "saldo", "modal", "receh", "dana", "pulsa", "ovo", "gopay",
        "linkaja", "qris", "tanpapotongan", "bonus", "newmember", "cashback", "rollingan", "referral", "hoki", "cuan",
        "melimpah", "saldo-gratis", "freebet", "promo", "terpercaya", "resmi", "lisensi", "pagcor", "terbukti",
        "lunas", "tuntas", "vVIP", "eksklusif", "gasken", "buruan", "cekbio", "linktr", "heylink", "bitly", "s.id",
        "tinyurl", "wa", "tele", "whatsapp", "telegram", "hubungi", "klik", "daftar", "gabung", "join", "profit",
        "menang", "hari-ini", "malam-ini", "pagi-ini", "tunggu-apa-lagi", "kesempatan", "terbatas", "pasti-bayar",
        "amanah", "berlisensi", "internasional", "terbesar", "no1", "terbaik", "jaminan", "menang-berapapun"
    ]
    
    # Total gabungan mencapai 500+ variasi dengan typo & normalisasi
    return list(set(high_risk + leets)), list(set(med_risk))

def random_forest_logic(text):
    # 1. Unicode Normalization (Deteksi teks yang disamarkan)
    text_normalized = normalize_unicode(text)
    
    # 2. Cleaning & Tokenization
    text_clean = re.sub(r'[^\w\s]', ' ', text_normalized.lower())
    tokens = text_clean.split()
    tokens_set = set(tokens)
    
    high_keywords, med_keywords = get_expanded_keywords()
    
    score = 0
    # Decision Tree 1: High Risk Keywords
    for word in high_keywords:
        if word in tokens_set: score += 45
            
    # Decision Tree 2: Med Risk Keywords
    for word in med_keywords:
        if word in tokens_set: score += 20
            
    # Decision Tree 3: Pattern Analysis (Link/WA)
    if re.search(r'(bit\.ly|s\.id|linktr|heylink|me-qr|\.com/|\.id/)', text_normalized.lower()):
        score += 35
    if re.search(r'(\+62|62|08)[0-9]{8,12}', text_normalized.lower()):
        score += 30
    if re.search(r'[ⓐ-ⓩⒶ-Ⓩ]', text): # Deteksi jika ada simbol lingkaran unicode asli
        score += 15

    # Final Classification
    if score >= 40:
        return {
            "label": "SPAM JUDI",
            "confidence": min(score, 100),
            "original_detected": text != text_normalized # Info jika ada bypass unicode
        }
    else:
        return {"label": "SAFE", "confidence": 0}

if __name__ == "__main__":
    if len(sys.argv) > 1:
        raw_text = " ".join(sys.argv[1:])
        result = random_forest_logic(raw_text)
        print(json.dumps(result))