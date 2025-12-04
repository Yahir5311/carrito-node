// public/js/cart.js
document.addEventListener('DOMContentLoaded', () => {
  const qtyInputs = document.querySelectorAll('.cart-qty-input');

  qtyInputs.forEach(input => {
    input.addEventListener('change', async (e) => {
      const quantity = parseInt(e.target.value);
      const productId = e.target.dataset.productId;

      if (!productId || isNaN(quantity) || quantity <= 0) return;

      try {
        const res = await fetch(`/cart/update/${productId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ quantity })
        });

        const data = await res.json();
        // Actualizar totales
        const totalQtyEl = document.getElementById('cartTotalQty');
        const totalPriceEl = document.getElementById('cartTotalPrice');

        if (totalQtyEl && totalPriceEl) {
          totalQtyEl.textContent = data.totalQty;
          totalPriceEl.textContent = data.totalPrice.toFixed(2);
        }

        // También recarga la página para ver subtotales correctos (simple)
        location.reload();
      } catch (err) {
        console.error(err);
      }
    });
  });
});
