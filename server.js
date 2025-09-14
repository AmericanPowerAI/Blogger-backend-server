// server.js - Backend API for Innovation Pulse Blog
const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || 'your-username';
const REPO_NAME = process.env.REPO_NAME || 'innovation-pulse-backend';

const octokit = new Octokit({
  auth: GITHUB_TOKEN
});

// Category default images
const categoryImages = {
  'ai': 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=600&fit=crop',
  'technology': 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=600&fit=crop',
  'security': 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&h=600&fit=crop',
  'energy': 'https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=800&h=600&fit=crop',
  'business': 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=800&h=600&fit=crop'
};

// Load articles from local file
async function loadArticles() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'articles.json'), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.log('No articles.json found, starting with empty array');
    return [];
  }
}

// Save articles to local file and commit to GitHub
async function saveArticles(articles, commitMessage) {
  try {
    // Save locally
    await fs.writeFile(
      path.join(__dirname, 'articles.json'),
      JSON.stringify(articles, null, 2),
      'utf8'
    );

    // Commit to GitHub
    const content = Buffer.from(JSON.stringify(articles, null, 2)).toString('base64');
    
    try {
      // Try to get existing file SHA
      const { data: fileData } = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: 'articles.json'
      });

      // Update existing file
      await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: 'articles.json',
        message: commitMessage,
        content: content,
        sha: fileData.sha
      });
    } catch (error) {
      // File doesn't exist, create it
      await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: 'articles.json',
        message: commitMessage,
        content: content
      });
    }

    console.log('✅ Committed to GitHub:', commitMessage);
  } catch (error) {
    console.error('❌ Error saving/committing:', error.message);
    throw error;
  }
}

// Upload image to GitHub
async function uploadImageToGitHub(imageData, filename) {
  try {
    const imagePath = `images/${filename}`;
    
    // Remove data URL prefix if present
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: imagePath,
      message: `Upload image: ${filename}`,
      content: base64Data
    });

    // Return the raw GitHub URL
    return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${imagePath}`;
  } catch (error) {
    console.error('❌ Error uploading image:', error.message);
    throw error;
  }
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all articles
app.get('/api/articles', async (req, res) => {
  try {
    const articles = await loadArticles();
    res.json(articles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load articles' });
  }
});

// Get single article
app.get('/api/articles/:id', async (req, res) => {
  try {
    const articles = await loadArticles();
    const article = articles.find(a => a.id === req.params.id);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load article' });
  }
});

// Create new article
app.post('/api/articles', async (req, res) => {
  try {
    const { title, category, excerpt, content, customImageUrl, imageData } = req.body;
    
    let imageUrl = categoryImages[category] || categoryImages['technology'];
    
    // Handle custom image
    if (customImageUrl && customImageUrl.trim()) {
      imageUrl = customImageUrl;
    } else if (imageData) {
      // Upload image to GitHub
      const filename = `article-${Date.now()}.${imageData.includes('data:image/png') ? 'png' : 'jpg'}`;
      imageUrl = await uploadImageToGitHub(imageData, filename);
    }

    const newArticle = {
      id: Date.now().toString(),
      title,
      category,
      excerpt,
      content,
      image: imageUrl,
      date: new Date().toISOString(),
      views: 0
    };

    const articles = await loadArticles();
    articles.unshift(newArticle);
    
    await saveArticles(articles, `Added new article: ${title}`);
    res.status(201).json(newArticle);
  } catch (error) {
    console.error('Error creating article:', error);
    res.status(500).json({ error: 'Failed to create article' });
  }
});

// Update article
app.put('/api/articles/:id', async (req, res) => {
  try {
    const { title, category, excerpt, content, customImageUrl, imageData } = req.body;
    const articles = await loadArticles();
    const index = articles.findIndex(a => a.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Article not found' });
    }

    let imageUrl = articles[index].image;
    
    // Handle image update
    if (customImageUrl && customImageUrl.trim()) {
      imageUrl = customImageUrl;
    } else if (imageData) {
      const filename = `article-${req.params.id}-updated.${imageData.includes('data:image/png') ? 'png' : 'jpg'}`;
      imageUrl = await uploadImageToGitHub(imageData, filename);
    }

    articles[index] = {
      ...articles[index],
      title,
      category,
      excerpt,
      content,
      image: imageUrl,
      date: new Date().toISOString()
    };

    await saveArticles(articles, `Updated article: ${title}`);
    res.json(articles[index]);
  } catch (error) {
    console.error('Error updating article:', error);
    res.status(500).json({ error: 'Failed to update article' });
  }
});

// Delete article
app.delete('/api/articles/:id', async (req, res) => {
  try {
    const articles = await loadArticles();
    const index = articles.findIndex(a => a.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const deletedArticle = articles[index];
    articles.splice(index, 1);
    
    await saveArticles(articles, `Deleted article: ${deletedArticle.title}`);
    res.json({ message: 'Article deleted successfully' });
  } catch (error) {
    console.error('Error deleting article:', error);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

// Upload image endpoint
app.post('/api/upload-image', async (req, res) => {
  try {
    const { imageData, filename } = req.body;
    const imageUrl = await uploadImageToGitHub(imageData, filename || `image-${Date.now()}.jpg`);
    res.json({ imageUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});
